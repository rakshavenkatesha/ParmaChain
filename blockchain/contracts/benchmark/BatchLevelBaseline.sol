// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BatchLevelBaseline
 * @notice BASELINE for docs/RESEARCH.md. Modelled on the batch/box-level approach of
 *         batch-level drug-traceability papers such as Musamih et al. (IEEE Access 2021): a lot is
 *         registered with a number of boxes, ownership moves lot by lot, and sales are recorded
 *         per box. This is NOT the authors' code - it is a minimal re-implementation of the design
 *         idea for gas and security comparison.
 *
 *         Verification only checks that the lot exists, and sale records carry no uniqueness
 *         guarantee, so a copied box label is indistinguishable from the genuine one.
 */
contract BatchLevelBaseline {
    struct Lot {
        address manufacturer;
        address owner;
        uint32 boxes;
        uint64 createdAt;
        bool exists;
    }

    mapping(bytes32 => Lot) public lots;
    mapping(bytes32 => uint256) public salesRecorded;

    event LotRegistered(bytes32 indexed lotKey, uint32 boxes);
    event LotTransferred(bytes32 indexed lotKey, address indexed from, address indexed to);
    event BoxSold(bytes32 indexed lotKey, uint32 indexed boxId, address indexed seller);

    function registerLot(bytes32 lotKey, uint32 boxes) external {
        require(!lots[lotKey].exists, "Lot exists");
        lots[lotKey] = Lot(msg.sender, msg.sender, boxes, uint64(block.timestamp), true);
        emit LotRegistered(lotKey, boxes);
    }

    function transferLot(bytes32 lotKey, address to) external {
        Lot storage l = lots[lotKey];
        require(l.owner == msg.sender, "Not owner");
        l.owner = to;
        emit LotTransferred(lotKey, msg.sender, to);
    }

    /// @notice Records a sale of box `boxId`. No duplicate check - mirrors label-level verification
    ///         that cannot tell a copy from the original.
    function sellBox(bytes32 lotKey, uint32 boxId) external {
        Lot storage l = lots[lotKey];
        require(l.owner == msg.sender, "Not owner");
        require(boxId < l.boxes, "Unknown box");
        salesRecorded[lotKey] += 1;
        emit BoxSold(lotKey, boxId, msg.sender);
    }

    function verifyBox(bytes32 lotKey, uint32 boxId) external view returns (bool) {
        return lots[lotKey].exists && boxId < lots[lotKey].boxes;
    }
}
