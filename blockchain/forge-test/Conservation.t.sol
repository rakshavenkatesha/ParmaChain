// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Strings.sol";
import "../contracts/AccessRegistry.sol";
import "../contracts/Governance.sol";
import "../contracts/PharmaChain.sol";
import "./Base.sol";

/// @dev Drives random splits and custody transfers of one production lot.
contract SplitHandler is Base {
    PharmaChain public chain;
    address public mfr;
    address public dist;
    address public dist2;
    string[] public ids;
    uint256 public splits;
    uint256 public transfers;

    constructor(PharmaChain _chain, address _mfr, address _dist, address _dist2, string memory lotId) {
        chain = _chain;
        mfr = _mfr;
        dist = _dist;
        dist2 = _dist2;
        ids.push(lotId);
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function _pick(uint256 seed) internal view returns (string memory) {
        return ids[seed % ids.length];
    }

    function _onShelf(PharmaChain.BatchView memory v) internal pure returns (bool) {
        return v.batch.status == PharmaChain.Status.Manufactured || v.batch.status == PharmaChain.Status.Received;
    }

    function split(uint256 seed, uint256 qtySeed) external {
        string memory id = _pick(seed);
        PharmaChain.BatchView memory v = chain.getBatch(id);
        uint32 held = v.batch.unitEnd - v.batch.unitStart;
        if (held < 2 || !_onShelf(v)) return;
        uint32 q = uint32(bound(qtySeed, 1, held - 1));
        string memory child = string.concat("S", Strings.toString(splits + 1));
        vm.prank(v.batch.currentOwner);
        chain.splitBatch(id, child, q);
        ids.push(child);
        splits++;
    }

    function ship(uint256 seed, bool alt) external {
        string memory id = _pick(seed);
        PharmaChain.BatchView memory v = chain.getBatch(id);
        if (!_onShelf(v)) return;
        address owner = v.batch.currentOwner;
        address to = owner == mfr ? (alt ? dist2 : dist) : (owner == dist ? dist2 : dist);
        vm.prank(owner);
        chain.transferOwnership(id, to);
        vm.prank(to);
        chain.acceptShipment(id);
        transfers++;
    }
}

contract ConservationInvariantTest is Base {
    PharmaChain chain;
    SplitHandler handler;
    uint32 constant LOT = 1000;
    address constant MFR = address(0x1001);
    address constant DIST = address(0x1002);
    address constant DIST2 = address(0x1003);

    function setUp() public {
        AccessRegistry registry = new AccessRegistry(address(this));
        address[] memory signers = new address[](1);
        signers[0] = address(this);
        Governance gov = new Governance(signers, 1);
        chain = new PharmaChain(registry, address(gov));
        registry.registerParticipant(MFR, AccessRegistry.Role.Manufacturer, "M", bytes32(0));
        registry.registerParticipant(DIST, AccessRegistry.Role.Distributor, "D", bytes32(0));
        registry.registerParticipant(DIST2, AccessRegistry.Role.Distributor, "D2", bytes32(0));

        vm.warp(1_700_000_000);
        vm.prank(MFR);
        chain.registerBatch(
            PharmaChain.RegisterParams({
                batchId: "LOT",
                drugName: "Fuzz",
                productCode: "F",
                quantity: LOT,
                productionDate: uint64(block.timestamp - 1 days),
                expiryDate: uint64(block.timestamp + 365 days),
                minTempDeci: 20,
                maxTempDeci: 80,
                unitRoot: keccak256("root"),
                packsPerCarton: 8,
                cartonsPerCase: 4,
                zkRoot: bytes32(0)
            })
        );
        handler = new SplitHandler(chain, MFR, DIST, DIST2, "LOT");
        _targets.push(address(handler));
        bytes4[] memory sel = new bytes4[](2);
        sel[0] = SplitHandler.split.selector;
        sel[1] = SplitHandler.ship.selector;
        _targetSelectors.push(FuzzSelector(address(handler), sel));
    }

    /// @notice Units are never created or destroyed by splitting or shipping.
    function invariant_unitsConserved() public view {
        uint256 n = handler.idCount();
        uint256 total;
        for (uint256 i = 0; i < n; i++) total += chain.getBatch(handler.ids(i)).quantity;
        require(total == LOT, "sum of shipment quantities != lot size");
    }

    /// @notice Unit ranges of different shipments never overlap and stay inside the lot.
    function invariant_rangesDisjoint() public view {
        uint256 n = handler.idCount();
        for (uint256 i = 0; i < n; i++) {
            PharmaChain.BatchView memory a = chain.getBatch(handler.ids(i));
            require(a.batch.unitStart < a.batch.unitEnd && a.batch.unitEnd <= LOT, "range outside lot");
            for (uint256 j = i + 1; j < n; j++) {
                PharmaChain.BatchView memory b = chain.getBatch(handler.ids(j));
                require(a.batch.unitEnd <= b.batch.unitStart || b.batch.unitEnd <= a.batch.unitStart, "overlapping ranges");
            }
        }
    }

    /// @notice Every shipment descends from the same production lot.
    function invariant_sameOrigin() public view {
        bytes32 origin = chain.keyOf("LOT");
        uint256 n = handler.idCount();
        for (uint256 i = 0; i < n; i++) require(chain.getBatch(handler.ids(i)).batch.originKey == origin, "foreign origin");
    }
}
