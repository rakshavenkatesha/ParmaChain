// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../AccessRegistry.sol";
import "../PharmaChain.sol";

interface IGroth16Verifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[5] calldata pubSignals) external view returns (bool);
}

/**
 * @title PrivateDispenser
 * @notice Zero-knowledge dispensing for PRIVATE lots (registered with a Poseidon zkRoot).
 *
 * The pharmacy submits a Groth16 proof that it knows the scratch code of SOME pack of the lot
 * whose index lies inside its own shipment's unit range - without revealing which pack. The
 * public nullifier Poseidon(lotTag, hidden, 1) is stored, so the same pack can never be dispensed
 * twice, yet the on-chain record cannot be linked to a pack index, patient or competitor.
 *
 *   public signals = [zkRoot, nullifier, unitStart, unitEnd, lotTag]   (circuits/private_dispense.circom)
 *
 * A valid proof with an already-spent nullifier is recorded as clone evidence (no revert).
 */
contract PrivateDispenser {
    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    PharmaChain public immutable pharma;
    AccessRegistry public immutable registry;
    IGroth16Verifier public immutable verifier;

    mapping(bytes32 => bool) private _nullifierUsed;

    event PrivateCloneDetected(bytes32 indexed holdingKey, bytes32 indexed nullifier, address indexed pharmacy, uint256 timestamp);

    constructor(PharmaChain _pharma, AccessRegistry _registry, IGroth16Verifier _verifier) {
        pharma = _pharma;
        registry = _registry;
        verifier = _verifier;
    }

    function lotTagOf(bytes32 originKey) public pure returns (uint256) {
        return uint256(originKey) % FIELD;
    }

    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return _nullifierUsed[nullifier];
    }

    function dispense(
        string calldata holdingBatchId,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        bytes32 nullifier
    ) external returns (bool) {
        require(registry.activeRoleOf(msg.sender) == AccessRegistry.Role.Pharmacy, "Unauthorised role");
        PharmaChain.BatchView memory v = pharma.getBatch(holdingBatchId);
        require(v.batch.zkRoot != bytes32(0), "Not a private lot");
        require(v.batch.currentOwner == msg.sender, "Caller is not the current owner");

        uint256[5] memory pub = [
            uint256(v.batch.zkRoot),
            uint256(nullifier),
            uint256(v.batch.unitStart),
            uint256(v.batch.unitEnd),
            lotTagOf(v.batch.originKey)
        ];
        require(verifier.verifyProof(a, b, c, pub), "Invalid zero-knowledge proof");

        if (_nullifierUsed[nullifier]) {
            emit PrivateCloneDetected(pharma.keyOf(holdingBatchId), nullifier, msg.sender, block.timestamp);
            return false;
        }
        _nullifierUsed[nullifier] = true;
        pharma.recordPrivateDispense(holdingBatchId, msg.sender, nullifier);
        return true;
    }
}
