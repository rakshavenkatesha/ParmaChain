// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/AccessRegistry.sol";
import "../contracts/Governance.sol";
import "../contracts/PharmaChain.sol";
import "./Base.sol";

/**
 * Fuzz tests on a small two-part-label lot whose hierarchy (2 cartons x 4 packs, 1 case) is built
 * in Solidity, independently of the JavaScript library.
 */
contract LabelsFuzzTest is Base {
    PharmaChain chain;
    bytes32 origin;
    address constant MFR = address(0x2001);
    address constant DIST = address(0x2002);
    address constant RX = address(0x2003);
    string constant ID = "FZ";

    bytes32[8] tags;
    bytes10[8] codes;
    bytes32[8] commits;
    bytes32[8] leaves;
    bytes32[2][2] mids; // mids[carton][0] = hash(l0,l1), [1] = hash(l2,l3)
    bytes32[2] cartonLeaves;

    function setUp() public {
        AccessRegistry registry = new AccessRegistry(address(this));
        address[] memory signers = new address[](1);
        signers[0] = address(this);
        chain = new PharmaChain(registry, address(new Governance(signers, 1)));
        registry.registerParticipant(MFR, AccessRegistry.Role.Manufacturer, "M", bytes32(0));
        registry.registerParticipant(DIST, AccessRegistry.Role.Distributor, "D", bytes32(0));
        registry.registerParticipant(RX, AccessRegistry.Role.Pharmacy, "P", bytes32(0));
        origin = chain.keyOf(ID);

        for (uint256 i = 0; i < 8; i++) {
            tags[i] = keccak256(abi.encode("public", i));
            codes[i] = bytes10(keccak256(abi.encode("hidden", i)));
            commits[i] = chain.hiddenCommitment(origin, i, codes[i]);
            leaves[i] = chain.packLeaf(origin, i, tags[i], commits[i]);
        }
        bytes32[2] memory cartonRoots;
        for (uint256 c = 0; c < 2; c++) {
            mids[c][0] = hashPair(leaves[4 * c], leaves[4 * c + 1]);
            mids[c][1] = hashPair(leaves[4 * c + 2], leaves[4 * c + 3]);
            cartonRoots[c] = hashPair(mids[c][0], mids[c][1]);
            cartonLeaves[c] = chain.aggregateLeaf(origin, 1, c, cartonRoots[c]);
        }
        bytes32 caseRoot = hashPair(cartonLeaves[0], cartonLeaves[1]);
        bytes32 lotRoot = chain.aggregateLeaf(origin, 2, 0, caseRoot); // single case -> root = case leaf

        vm.warp(1_700_000_000);
        vm.prank(MFR);
        chain.registerBatch(
            PharmaChain.RegisterParams({
                batchId: ID,
                drugName: "Fuzz",
                productCode: "F",
                quantity: 8,
                productionDate: uint64(block.timestamp - 1 days),
                expiryDate: uint64(block.timestamp + 365 days),
                minTempDeci: 20,
                maxTempDeci: 80,
                unitRoot: lotRoot,
                packsPerCarton: 4,
                cartonsPerCase: 2,
                zkRoot: bytes32(0)
            })
        );
        vm.prank(MFR);
        chain.transferOwnership(ID, DIST);
        vm.prank(DIST);
        chain.acceptShipment(ID);
        vm.prank(DIST);
        chain.transferOwnership(ID, RX);
        vm.prank(RX);
        chain.acceptShipment(ID);
    }

    function _proof(uint256 i) internal view returns (PharmaChain.UnitProof memory p) {
        uint256 c = i / 4;
        uint256 pos = i % 4;
        p.pack = new bytes32[](2);
        p.pack[0] = leaves[4 * c + (pos ^ 1)];
        p.pack[1] = pos < 2 ? mids[c][1] : mids[c][0];
        p.carton = new bytes32[](1);
        p.carton[0] = cartonLeaves[1 - c];
        p.kase = new bytes32[](0);
    }

    function _claim(uint256 i) internal view returns (PharmaChain.UnitClaim memory) {
        return PharmaChain.UnitClaim(uint32(i), tags[i], codes[i]);
    }

    function test_everyGenuinePackVerifies() public view {
        for (uint256 i = 0; i < 8; i++) {
            (bool ok, , , ) = chain.verifyUnit(ID, i, tags[i], commits[i], _proof(i));
            require(ok, "genuine pack failed verification");
        }
    }

    /// @notice Without the genuine scratch code a pack can never be dispensed.
    function testFuzz_forgedHiddenCodeNeverDispenses(uint8 i, bytes10 code) public {
        i = uint8(bound(i, 0, 7));
        vm.assume(code != codes[i]);
        PharmaChain.UnitClaim memory c = PharmaChain.UnitClaim(i, tags[i], code);
        vm.prank(RX);
        PharmaChain.DispenseResult r = chain.decommissionUnit(ID, c, _proof(i));
        require(r == PharmaChain.DispenseResult.InvalidProof, "forged code accepted");
        require(!chain.isDispensed(origin, i), "bit set by forged code");
    }

    /// @notice A forged visible tag never passes consumer verification.
    function testFuzz_forgedPublicTagNeverVerifies(uint8 i, bytes32 tag, bytes32 commitment) public view {
        i = uint8(bound(i, 0, 7));
        vm.assume(tag != tags[i] || commitment != commits[i]);
        (bool ok, , , ) = chain.verifyUnit(ID, i, tag, commitment, _proof(i));
        require(!ok, "forged label verified");
    }

    /// @notice A unit is dispensed at most once, whatever order the presentations come in.
    function testFuzz_neverDispensedTwice(uint8 i, uint8 repeats) public {
        i = uint8(bound(i, 0, 7));
        repeats = uint8(bound(repeats, 1, 6));
        uint32 before = chain.getBatch(ID).remaining;
        uint256 ok;
        for (uint256 k = 0; k <= repeats; k++) {
            vm.prank(RX);
            if (chain.decommissionUnit(ID, _claim(i), _proof(i)) == PharmaChain.DispenseResult.Dispensed) ok++;
        }
        require(ok == 1, "unit dispensed more than once");
        require(chain.getBatch(ID).remaining == before - 1, "remaining count drifted");
    }

    /// @notice A genuine label shown with another unit's index is rejected.
    function testFuzz_indexSwapRejected(uint8 i, uint8 j) public {
        i = uint8(bound(i, 0, 7));
        j = uint8(bound(j, 0, 7));
        vm.assume(i != j);
        PharmaChain.UnitClaim memory c = PharmaChain.UnitClaim(j, tags[i], codes[i]);
        vm.prank(RX);
        require(chain.decommissionUnit(ID, c, _proof(i)) == PharmaChain.DispenseResult.InvalidProof, "index swap accepted");
    }
}
