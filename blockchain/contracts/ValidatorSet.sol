// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ValidatorSet
 * @notice QBFT "contract validator selection": Besu asks this contract for the validator list
 *         at every block (getValidators()). It is placed in the GENESIS block at a fixed address
 *         (see scripts/network/generate-genesis.js) with the four founding validators in storage.
 *
 *         After deployment the bootstrap owner hands control to the Governance multisig, so the
 *         validator set can only change by an M-of-N regulator decision recorded on-chain.
 *
 * Storage layout is fixed because the genesis generator writes it directly:
 *   slot 0: owner (bootstrap key)      slot 1: controller (Governance)
 *   slot 2: validators.length          keccak256(2) + i: validators[i]
 */
contract ValidatorSet {
    address public owner;
    address public controller;
    address[] private validators;

    event ControllerSet(address indexed controller);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    /// @dev Only used when deployed normally (tests). In genesis the constructor never runs.
    constructor(address[] memory initial, address _owner) {
        owner = _owner;
        for (uint256 i = 0; i < initial.length; i++) validators.push(initial[i]);
    }

    function getValidators() external view returns (address[] memory) {
        return validators;
    }

    /// @notice One-time hand-over from the bootstrap owner to the Governance multisig.
    function setController(address _controller) external {
        require(msg.sender == owner, "Only bootstrap owner");
        require(controller == address(0), "Controller already set");
        require(_controller != address(0), "Zero controller");
        controller = _controller;
        owner = address(0); // bootstrap key is burned
        emit ControllerSet(_controller);
    }

    function addValidator(address v) external {
        require(msg.sender == controller, "Only governance");
        require(v != address(0), "Zero address");
        for (uint256 i = 0; i < validators.length; i++) require(validators[i] != v, "Already a validator");
        validators.push(v);
        emit ValidatorAdded(v);
    }

    function removeValidator(address v) external {
        require(msg.sender == controller, "Only governance");
        require(validators.length > 1, "Cannot remove the last validator");
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] == v) {
                validators[i] = validators[validators.length - 1];
                validators.pop();
                emit ValidatorRemoved(v);
                return;
            }
        }
        revert("Not a validator");
    }
}
