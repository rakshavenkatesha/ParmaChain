// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SupplyChain {
    
    struct Batch {
        string batchId;
        string drugName;
        string productCode;
        address manufacturer;
        address currentOwner;
        uint256 quantity;
        uint256 productionDate;
        uint256 expiryDate;
        string status; // "Manufactured", "In Transit", "Received", "Recalled"
        address[] chainOfCustody;
        uint256[] transactionTimestamps;
        bool exists;
    }

    mapping(string => Batch) private batches;
    string[] private batchIds;

    // Events
    event BatchRegistered(
        string batchId, 
        address indexed manufacturer, 
        string drugName, 
        uint256 quantity,
        uint256 timestamp
    );
    
    event TransferInitiated(
        string batchId, 
        address indexed from, 
        address indexed to, 
        uint256 timestamp
    );
    
    event ShipmentAccepted(
        string batchId, 
        address indexed owner, 
        uint256 timestamp
    );
    
    event BatchRecalled(
        string batchId, 
        address indexed recalledBy, 
        uint256 timestamp
    );

    // Modifiers
    modifier onlyCurrentOwner(string memory _batchId) {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].currentOwner == msg.sender, "Caller is not the current owner");
        _;
    }

    modifier onlyManufacturer(string memory _batchId) {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].manufacturer == msg.sender, "Caller is not the manufacturer");
        _;
    }

    /**
     * @dev Register a new drug batch. Accessible by Manufacturers.
     */
    function registerBatch(
        string memory _batchId,
        string memory _drugName,
        string memory _productCode,
        uint256 _quantity,
        uint256 _productionDate,
        uint256 _expiryDate
    ) public {
        require(bytes(_batchId).length > 0, "Batch ID cannot be empty");
        require(!batches[_batchId].exists, "Batch ID already exists");
        require(_expiryDate > _productionDate, "Expiry date must be after production date");

        address[] memory custodyList = new address[](1);
        custodyList[0] = msg.sender;

        uint256[] memory timestampList = new uint256[](1);
        timestampList[0] = block.timestamp;

        batches[_batchId] = Batch({
            batchId: _batchId,
            drugName: _drugName,
            productCode: _productCode,
            manufacturer: msg.sender,
            currentOwner: msg.sender,
            quantity: _quantity,
            productionDate: _productionDate,
            expiryDate: _expiryDate,
            status: "Manufactured",
            chainOfCustody: custodyList,
            transactionTimestamps: timestampList,
            exists: true
        });

        batchIds.push(_batchId);

        emit BatchRegistered(_batchId, msg.sender, _drugName, _quantity, block.timestamp);
    }

    /**
     * @dev Initiate a transfer to another entity (e.g., Manufacturer -> Distributor, or Distributor -> Pharmacy).
     */
    function transferOwnership(string memory _batchId, address _to) public onlyCurrentOwner(_batchId) {
        require(_to != address(0), "Cannot transfer to the zero address");
        require(_to != msg.sender, "Cannot transfer ownership to yourself");
        
        Batch storage batch = batches[_batchId];
        // Ensure the batch is not currently in transit or recalled
        require(
            keccak256(abi.encodePacked(batch.status)) != keccak256(abi.encodePacked("In Transit")), 
            "Batch is already in transit"
        );
        require(
            keccak256(abi.encodePacked(batch.status)) != keccak256(abi.encodePacked("Recalled")), 
            "Cannot transfer a recalled batch"
        );

        batch.currentOwner = _to;
        batch.status = "In Transit";

        emit TransferInitiated(_batchId, msg.sender, _to, block.timestamp);
    }

    /**
     * @dev Accept the shipment. The new owner confirms receipt of the batch.
     */
    function acceptShipment(string memory _batchId) public onlyCurrentOwner(_batchId) {
        Batch storage batch = batches[_batchId];
        require(
            keccak256(abi.encodePacked(batch.status)) == keccak256(abi.encodePacked("In Transit")), 
            "Batch is not in transit"
        );

        batch.status = "Received";
        batch.chainOfCustody.push(msg.sender);
        batch.transactionTimestamps.push(block.timestamp);

        emit ShipmentAccepted(_batchId, msg.sender, block.timestamp);
    }

    /**
     * @dev Recall a batch. Only the original manufacturer can trigger a recall.
     */
    function recallBatch(string memory _batchId) public onlyManufacturer(_batchId) {
        Batch storage batch = batches[_batchId];
        require(
            keccak256(abi.encodePacked(batch.status)) != keccak256(abi.encodePacked("Recalled")), 
            "Batch is already recalled"
        );

        batch.status = "Recalled";
        emit BatchRecalled(_batchId, msg.sender, block.timestamp);
    }

    /**
     * @dev Get detailed information for a specific batch.
     */
    function getBatch(string memory _batchId) public view returns (
        string memory batchId,
        string memory drugName,
        string memory productCode,
        address manufacturer,
        address currentOwner,
        uint256 quantity,
        uint256 productionDate,
        uint256 expiryDate,
        string memory status,
        address[] memory chainOfCustody,
        uint256[] memory transactionTimestamps,
        bool exists
    ) {
        require(batches[_batchId].exists, "Batch does not exist");
        Batch memory batch = batches[_batchId];
        return (
            batch.batchId,
            batch.drugName,
            batch.productCode,
            batch.manufacturer,
            batch.currentOwner,
            batch.quantity,
            batch.productionDate,
            batch.expiryDate,
            batch.status,
            batch.chainOfCustody,
            batch.transactionTimestamps,
            batch.exists
        );
    }

    /**
     * @dev Returns custody logs list and timestamps for history visualizer.
     */
    function getBatchHistory(string memory _batchId) public view returns (
        address[] memory custodyList, 
        uint256[] memory timestampList
    ) {
        require(batches[_batchId].exists, "Batch does not exist");
        return (batches[_batchId].chainOfCustody, batches[_batchId].transactionTimestamps);
    }

    /**
     * @dev Get all batch IDs.
     */
    function getAllBatchIds() public view returns (string[] memory) {
        return batchIds;
    }
}
