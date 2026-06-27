# **Veterinary Clinic Management System**

## **Product Requirements Document (PRD)**

# **1\. Project Overview**

Develop a cloud-based Veterinary Clinic Management System to digitize the clinic's daily operations. The application should be accessible from any desktop, tablet, or mobile device through a secure web link with real-time data synchronization.

### **Objectives**

- Eliminate manual record keeping.
- Provide quick access to patient information.
- Automate appointments, follow-ups, vaccinations, and inventory.
- Enable secure role-based access for clinic staff.
- Build a scalable foundation for future modules such as billing and multi-branch support.

# **2\. User Roles**

| **Role**                 | **Access**                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Administrator**        | Full access to all modules, users, settings, reports, and inventory.                                                                                     |
| ---                      | ---                                                                                                                                                      |
| **Manager (Semi-Admin)** | Operational access to clients, pets, appointments, consultations, vaccinations, inventory, and reports. No access to user management or system settings. |
| ---                      | ---                                                                                                                                                      |

# **3\. Application Navigation**

Dashboard

Clients

• Client List

• Add Client

Pets

• Pet List

• Add Pet

Appointments

• Calendar

• Today's Appointments

• OPD

• Surgery

• Grooming

• Follow-ups

Consultations

Vaccinations

Inventory

• Medicines

• Low Stock

• Expiry Alerts

• Suppliers

Reports

• Daily Report

Settings

• Clinic Information

• User Management

# **4\. Dashboard**

A real-time overview of clinic operations.

### **KPI Cards**

- Today's Appointments
- Completed Appointments
- Pending Appointments
- Follow-ups Today
- Vaccinations Due
- Overdue Vaccinations
- Low Stock Medicines
- Expiring Medicines
- Current Inventory Value

### **Dashboard Widgets**

- Today's Appointment List
- Upcoming Follow-ups
- Vaccination Due List
- Inventory Alerts
- Expiry Alerts

# **5\. Client Management**

### **Required Fields**

- Client Name
- Mobile Number
- Address

### **Features**

- One client can own multiple pets.
- Search by client name or mobile number.
- Prevent duplicate mobile numbers.
- View all pets linked to a client.

# **6\. Pet Management**

Maintain a complete digital medical record for every pet.

### **Required Fields**

- Pet Name
- Breed
- Age
- Sex

### **Medical Information**

- Weight History
- Vaccination History
- Medical History
- Last 3 Consultations
- Deworming reminder after every 3 months for pet >6m age
- Medicines stock in alphabetical order

### **Medical Document Management**

The system shall allow uploading and managing medical documents for each pet.

Supported document types include:

- Scanned Prescriptions
- Laboratory Reports
- X-Rays
- Diagnostic Reports
- Other Medical Documents

### **Features**

- All uploaded documents shall be linked to the respective pet profile.
- Documents shall also be accessible from the consultation history.
- Support approximately **4,000 uploaded medical documents** within the free storage allocation.
- Display storage usage to the Administrator.
- Notify the Administrator when available storage is nearing capacity.
- Administrators may permanently delete unnecessary documents to free storage.
- Deleted documents cannot be recovered unless uploaded again.

# **7\. Appointment Management**

### **Appointment Types**

- OPD
- Surgery
- Grooming

### **Features**

- Create appointments
- Edit appointments
- Reschedule appointments
- Cancel appointments
- Automatic follow-up scheduling (5 Days / 1 Week)
- Display only the latest **1 week** of appointments in the active schedule
- Older appointments remain archived

# **8\. Consultation Module**

Administrators can record:

- Diagnosis
- Treatment
- Medicines
- Clinical Notes
- Printable Prescription
- Follow-up Recommendation

Patient history shall display only the latest **3 consultations**.

# **9\. Vaccination Module**

### **Supported Vaccines**

- Anti Rabies
- DHPPIL (7-in-1)
- DHPPIL (9-in-1)
- KC
- CCV
- TRICAT

### **Features**

- Auto Due Date
- Vaccination History
- Overdue Alerts
- WhatsApp Reminder (Future)

# **10\. Inventory Management**

### **Medicine Details**

- Medicine Name
- Batch Number
- Quantity
- Purchase Price
- Selling Price
- Supplier
- Expiry Date

### **Automation**

- Automatic stock deduction after prescription.
- Highlight medicines expiring within **6 months** in **Red**.
- Highlight medicines with stock **below 3 units** in **Yellow**.
- Display total inventory value based on purchase price.

# **11\. Reports**

### **Daily Report**

- Total Patients
- OPD Cases
- Surgery Cases
- Grooming Cases
- Vaccinations Administered
- Follow-up Appointments
- Low Stock Medicines
- Expiring Medicines
- Inventory Value

**Removed:** Revenue Reports and Billing Reports.

# **12\. Notifications**

- Appointment Reminders
- Vaccination Reminders
- Follow-up Reminders
- Dashboard Alerts for low stock and expiring medicines

# **13\. Security**

- Secure Login
- Role-Based Access Control
- Password-Protected

# **14\. Business Rules**

- One client can own multiple pets.
- One pet belongs to one client.
- Duplicate mobile numbers are not allowed.
- Follow-ups are limited to **5 Days** or **1 Week**.
- Active appointment history displays only the latest **1 week**.
- Patient history displays only the latest **3 consultations**.
- Medicines expiring within **6 months** are highlighted in **Red**.
- Medicines with stock below **3 units** are highlighted in **Yellow**.
- Inventory value is calculated using current stock × purchase price.
- Medical documents remain linked to the pet profile and consultation history until permanently deleted by an Administrator.
- All saved data can only be deleted by the Administrator.

# **15\. Additional Details**
- On UI show reminders intuitivly for everything where possible and make sense