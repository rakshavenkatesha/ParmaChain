# Blockchain-Based Pharmaceutical Supply Chain Management System with QR Verification and Anomaly Detection

## Project Description

The Blockchain-Based Pharmaceutical Supply Chain Management System is a secure web-based platform designed to track pharmaceutical products from manufacturing to final delivery while preventing counterfeit medicines from entering the supply chain. The system utilizes blockchain technology to create immutable and transparent records of every transaction, ensuring trust among manufacturers, distributors, pharmacies, regulatory authorities, and consumers.

Each drug batch is assigned a unique Batch ID and QR code at the time of manufacturing. Every movement of the drug through the supply chain is recorded on the blockchain through smart contracts. Customers can verify the authenticity of medicines by scanning the QR code and viewing the complete product journey.

The system also includes anomaly detection mechanisms that identify suspicious activities such as duplicate batch registrations, missing supply chain stages, unauthorized ownership transfers, and unusual transaction patterns that may indicate counterfeit products or fraudulent activities.

The primary objective of this project is to enhance transparency, traceability, security, and trust in the pharmaceutical supply chain while reducing the risk of counterfeit drugs reaching consumers.

---

## Phase-Wise Features

### Phase 1: User Management and Authentication

*   **User Registration**: Allow users to register as Manufacturer, Distributor, Pharmacy, or Administrator with role-specific information.
*   **Secure Login**: Provide secure authentication using email and password with encrypted credential storage.
*   **Role-Based Access Control**: Restrict access to features based on user roles and permissions.
*   **User Profile Management**: Allow users to view and update their personal and company information.
*   **Account Verification**: Enable administrators to approve or verify newly registered organizations before they can participate in the supply chain.
*   **Password Recovery**: Allow users to reset forgotten passwords securely.
*   **User Activity Logs**: Maintain records of user actions for auditing and accountability.

### Phase 2: Drug Batch Management

*   **Drug Batch Registration**: Manufacturers can create new drug batches with product details.
*   **Batch ID Generation**: Automatically generate a unique identifier for every batch.
*   **Product Information Storage**: Store drug name, manufacturer, production date, expiry date, quantity, and batch details.
*   **Batch Status Management**: Track the current state of a drug batch throughout its lifecycle.
*   **Batch Search System**: Allow users to search for batches using batch IDs or product names.
*   **Batch Detail View**: Display complete information related to a specific batch.
*   **Product Expiry Monitoring**: Track expiration dates and identify expired products.

### Phase 3: Blockchain Integration

*   **Smart Contract Deployment**: Deploy blockchain smart contracts for managing pharmaceutical transactions.
*   **Blockchain-Based Batch Registration**: Store batch creation records on the blockchain.
*   **Ownership Transfer Recording**: Record every ownership change between supply chain participants.
*   **Transaction Hash Storage**: Store blockchain transaction references for verification.
*   **Immutable Audit Trail**: Maintain a permanent history of all product movements.
*   **Blockchain Verification**: Verify the authenticity and integrity of blockchain records.
*   **Smart Contract Event Logging**: Generate blockchain events for important supply chain activities.

### Phase 4: Supply Chain Tracking

*   **Manufacturer to Distributor Transfer**: Record shipment transfers from manufacturers to distributors.
*   **Distributor to Pharmacy Transfer**: Record ownership transfers from distributors to pharmacies.
*   **Shipment Acceptance Workflow**: Require recipients to confirm received shipments.
*   **Product Journey Tracking**: Display complete movement history of each batch.
*   **Chain of Custody Monitoring**: Track every handoff and ownership change.
*   **Transfer Validation**: Verify that transfers follow authorized supply chain routes.
*   **Current Owner Tracking**: Display the current owner of every drug batch.

### Phase 5: QR Code Verification System

*   **QR Code Generation**: Generate a unique QR code for each drug batch.
*   **QR Code Download and Printing**: Allow manufacturers to print QR labels for packaging.
*   **QR Code Scanning**: Enable users to scan QR codes using mobile devices.
*   **Product Verification Portal**: Allow consumers to verify product authenticity without logging in.
*   **Product History Display**: Show the complete supply chain history after QR verification.
*   **QR Authentication Status**: Display authenticity results such as Genuine, Suspicious, or Invalid.
*   **Public Verification Interface**: Provide a simple interface for customers to verify medicines.

### Phase 6: Counterfeit Detection and Anomaly Analysis

*   **Duplicate Batch Detection**: Identify multiple registrations using the same batch number.
*   **Duplicate QR Detection**: Detect QR codes associated with more than one product.
*   **Missing Supply Chain Step Detection**: Identify batches that skip expected transfer stages.
*   **Unauthorized Transfer Detection**: Detect transfers performed by unauthorized entities.
*   **Expired Product Detection**: Flag expired medicines still active in the supply chain.
*   **Suspicious Transaction Monitoring**: Identify abnormal transfer patterns and frequencies.
*   **Risk Score Calculation**: Assign a counterfeit risk score to each batch.
*   **Automated Alerts**: Generate notifications when suspicious activities are detected.
*   **Anomaly Reporting Dashboard**: Provide a centralized view of detected anomalies.

### Phase 7: Customer Verification Features

*   **Medicine Authenticity Verification**: Allow customers to confirm product authenticity.
*   **Product Origin Tracking**: Display the original manufacturer and creation details.
*   **Product Journey Timeline**: Visualize the complete supply chain path.
*   **Counterfeit Reporting**: Allow customers to report suspicious products.
*   **Consumer Feedback Submission**: Enable feedback regarding product authenticity.
*   **Verification History Tracking**: Store previous verification attempts.

### Phase 8: Inventory and Stock Management

*   **Inventory Tracking**: Monitor stock levels at distributors and pharmacies.
*   **Stock Movement History**: Record inventory changes over time.
*   **Low Stock Alerts**: Notify users when inventory reaches critical levels.
*   **Expiry-Based Inventory Monitoring**: Identify products approaching expiration.
*   **Inventory Dashboard**: Provide inventory analytics and summaries.
*   **Product Availability Status**: Track available and unavailable products.

### Phase 9: Administrative Dashboard and Analytics

*   **User Management Dashboard**: Manage manufacturers, distributors, pharmacies, and administrators.
*   **Drug Batch Statistics**: Display total registered and active batches.
*   **Supply Chain Analytics**: Analyze product movements and transfer trends.
*   **Counterfeit Detection Analytics**: Visualize anomaly detection results.
*   **Audit Logs Dashboard**: Monitor system activities and user actions.
*   **Regulatory Compliance Reports**: Generate reports for inspections and audits.
*   **Performance Metrics Dashboard**: Track platform performance and operational statistics.

### Phase 10: Documentation and Compliance Management

*   **Manufacturer License Management**: Store and manage manufacturer certifications.
*   **Distributor License Management**: Maintain distributor authorization records.
*   **Pharmacy Registration Documents**: Store pharmacy licenses and approvals.
*   **Compliance Document Upload**: Upload regulatory and quality assurance documents.
*   **Document Verification**: Verify the authenticity and integrity of uploaded documents.
*   **Blockchain Document Hashing**: Store document hashes on blockchain for tamper detection.

### Phase 11: Notification and Alert System

*   **Email Notifications**: Send updates regarding transfers and approvals.
*   **Expiry Alerts**: Notify stakeholders of approaching expiration dates.
*   **Transfer Notifications**: Inform users about ownership changes.
*   **Anomaly Alerts**: Send alerts when suspicious activities are detected.
*   **Registration Approval Notifications**: Notify users about account approval status.
*   **System Announcements**: Broadcast important platform updates.

### Phase 12: Advanced and Innovation Features

*   **Drug Recall Management**: Allow manufacturers to recall defective products.
*   **Digital Drug Passport**: Provide a complete digital history of each medicine.
*   **Geolocation Tracking**: Track shipment locations throughout the supply chain.
*   **Environmental Condition Monitoring**: Record transportation temperature and humidity.
*   **QR Scan Analytics**: Analyze verification activity and customer engagement.
*   **Predictive Counterfeit Detection**: Use machine learning to predict potential counterfeit risks.
*   **Regulatory Authority Portal**: Allow government inspectors to monitor supply chain activities.
*   **Real-Time Supply Chain Dashboard**: Provide live tracking and monitoring of pharmaceutical products.
*   **AI-Based Risk Assessment**: Automatically evaluate risk levels using historical data and anomalies.
*   **Supply Chain Performance Analytics**: Measure efficiency and identify bottlenecks within the distribution network.

---

## Recommended Semester Project Scope

For a typical 4–6 month academic project, the focus should be on:

1.  **Core System (Phases 1 to 7)**:
    *   Phase 1: User Management & Authentication (Manufacturer, Distributor, Pharmacy, Admin)
    *   Phase 2: Drug Batch Management
    *   Phase 3: Blockchain Integration (Smart contract record creation)
    *   Phase 4: Supply Chain Tracking (Shipment & ownership transfer)
    *   Phase 5: QR Code Verification System
    *   Phase 6: Counterfeit Detection & Anomaly Analysis (e.g. Duplicate batch/QR, missing steps, expired products)
    *   Phase 7: Customer Verification Portal (Origin tracking, timeline)
2.  **Selected Administrative & Alert Features (Phases 9 & 11)**:
    *   Phase 9: Administrative Dashboard (User management, system statistics)
    *   Phase 11: Notification & Alert System (Status notifications and anomaly alerts)



