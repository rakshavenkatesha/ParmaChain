// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal subset of Foundry's cheatcode interface (avoids vendoring forge-std).
interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function assume(bool) external pure;
    function expectRevert(bytes calldata) external;
    function warp(uint256) external;
}

abstract contract Base {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    address[] internal _targets;
    FuzzSelector[] internal _targetSelectors;

    /// @dev Read by forge's invariant engine (same ABI as forge-std StdInvariant).
    function targetContracts() public view returns (address[] memory) {
        return _targets;
    }

    function targetSelectors() public view returns (FuzzSelector[] memory) {
        return _targetSelectors;
    }

    function bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        if (hi <= lo) return lo;
        return lo + (x % (hi - lo + 1));
    }

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
