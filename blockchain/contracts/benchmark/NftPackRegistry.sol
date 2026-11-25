// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title NftPackRegistry
 * @notice BASELINE for docs/RESEARCH.md: the "one NFT per pack" design used by several NFT-based
 *         drug-traceability proposals. Every pack is an ERC-721 token minted at lot registration;
 *         custody moves by transferring every token; dispensing burns the token. A burned (or never
 *         minted) token presented again is reported as a clone.
 *         Costs are O(N) at registration AND at every custody step.
 */
contract NftPackRegistry is ERC721 {
    event CloneDetected(uint256 indexed tokenId, address indexed reporter);
    event PackDispensed(uint256 indexed tokenId, address indexed pharmacy);

    constructor() ERC721("PharmaPack", "PACK") {}

    /// @notice token id of pack `index` of `lotKey`
    function tokenIdOf(bytes32 lotKey, uint256 index) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(lotKey, index)));
    }

    /// @notice Mint packs [from, from+count) of a lot to the caller (chunked by the caller).
    function mintLot(bytes32 lotKey, uint256 from, uint256 count) external {
        for (uint256 i = from; i < from + count; i++) _mint(msg.sender, tokenIdOf(lotKey, i));
    }

    /// @notice Custody step: every token of the shipment must be transferred.
    function transferPacks(address to, bytes32 lotKey, uint256 from, uint256 count) external {
        for (uint256 i = from; i < from + count; i++) transferFrom(msg.sender, to, tokenIdOf(lotKey, i));
    }

    /// @notice Dispense = burn. Returns false (and records evidence) for a burned / unknown token.
    function dispense(uint256 tokenId) external returns (bool) {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) {
            emit CloneDetected(tokenId, msg.sender);
            return false;
        }
        require(owner == msg.sender, "Not holder");
        _burn(tokenId);
        emit PackDispensed(tokenId, msg.sender);
        return true;
    }
}
