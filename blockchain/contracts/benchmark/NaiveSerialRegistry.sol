// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NaiveSerialRegistry
 * @notice BASELINE used only for the evaluation in docs/RESEARCH.md.
 *         It represents the straightforward design found in many prior systems:
 *         every unit serial hash is written to storage at registration time and a
 *         per-unit boolean is set on dispense. Registration cost grows O(N).
 */
contract NaiveSerialRegistry {
    mapping(bytes32 => mapping(bytes32 => bool)) public isValidSerial;
    mapping(bytes32 => mapping(bytes32 => bool)) public isDispensed;

    function registerLot(bytes32 lotKey, bytes32[] calldata serialHashes) external {
        for (uint256 i = 0; i < serialHashes.length; i++) {
            isValidSerial[lotKey][serialHashes[i]] = true;
        }
    }

    function dispense(bytes32 lotKey, bytes32 serialHash) external returns (bool) {
        require(isValidSerial[lotKey][serialHash], "Unknown serial");
        if (isDispensed[lotKey][serialHash]) return false;
        isDispensed[lotKey][serialHash] = true;
        return true;
    }
}
