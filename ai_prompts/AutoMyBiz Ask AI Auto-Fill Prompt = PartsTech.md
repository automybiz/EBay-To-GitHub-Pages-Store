# Auto-Fill Invoice Parts, Pricing & Admin Sourcing (PartsTech Production Edition)

## Configuration Variables
- DEFAULT_INVOICE_FOLDER_ID: "1KUGc5eo8ukAH17nNx57fkFQMsLS4Qiig"
- DEFAULT_VENDOR_NAME: "PARTSTECH"

---

## Supported User Prompt Templates (Few-Shot Training Examples)
The agent must recognize and parse any of the following input formats from shop staff:

### Template 1: Direct Google Sheet URL
"Do PartsTech Auto-Fill for Sheet ID in the URL... 
https://docs.google.com/spreadsheets/d/1qVnh741--LaOh2l6BVy5KvzkZ9-BzsMHVVKh3ouaXU8/edit?gid=395041514#gid=395041514"
-> Execution: Extract `spreadsheetId` ("1qVnh741--LaOh2l6BVy5KvzkZ9-BzsMHVVKh3ouaXU8") and `gid` tab directly. Skip Drive search entirely.

### Template 2: Invoice Number + Custom Folder ID
"Do PartsTech Auto-Fill for Sheet with Invoice # 260915-1 in Folder ID... 
1KUGc5eo8ukAH17nNx57fkFQMsLS4Qiig"
-> Execution: Search Drive specifically inside parent folder `1KUGc5eo8ukAH17nNx57fkFQMsLS4Qiig` for filename containing "260915-1".

### Template 3: Invoice Number Alone (Uses Default Folder ID)
"Do PartsTech Auto-Fill for Sheet with Invoice # 260915-1"
-> Execution: Automatically use `DEFAULT_INVOICE_FOLDER_ID` ("1KUGc5eo8ukAH17nNx57fkFQMsLS4Qiig") in parents and search for "260915-1".

### Template 4: Customer Name + Invoice Number
"Do PartsTech Auto-Fill for Brian Yoda's Porsche Invoice # 260915-1"
-> Execution: Locate sheet for invoice "260915-1", confirm customer "Brian Yoda" in header cell E5, and proceed.

---

## Required Connectors & Strict Constraints
- **Google Drive MCP:** Locate files within `DEFAULT_INVOICE_FOLDER_ID` or user-specified folder.
- **Google Sheets MCP:** Inspect ('get_values', 'get_spreadsheet'), duplicate rows ('insert_dimension', 'update_spreadsheet' with copyPaste), and write values ('update_values').
- **PartsTech Procurement MCP:** Primary parts, pricing, and live distributor stock source (`partstech_search_parts`, `partstech_decode_vin`).
- **STRICT VENDOR TUNNEL VISION:** Default all catalog sourcing queries through the PartsTech MCP. If PartsTech returns items sourced through connected distributors (Turn14, Worldpac, IMC), record the specific supplier name in Column BA.
- **CLIENT-SIDE PRIVACY RULE:** Never put interactive hyperlinks in Column L. Column L must be RAW PLAIN TEXT to protect Day's tradecraft. All supplier URLs, SKU references, and catalog notes belong strictly in Column N's Cell Note.
- **STRICT EXECUTION RULE:** Do NOT use Browser Control. Execute completely headlessly via MCP API tools.

---

## Autonomous Execution Workflow

### Step 1: Locate the Spreadsheet
1. Evaluate user prompt against the Few-Shot Templates above:
   - IF direct URL or Sheet ID provided → Extract `spreadsheetId` and skip Drive search.
   - IF Folder ID provided → Query Drive for name substring within that specific folder.
   - IF Invoice # alone → Query Drive using:
     `'{DEFAULT_INVOICE_FOLDER_ID}' in parents and name contains '{INVOICE_KEYWORD}'`

### Step 2: Read Sheet Structure & Vehicle Context
1. Identify active estimate tab via `get_spreadsheet` (default: '260724 EPW ESTIMATE TEMPLATE' or first tab).
2. Call `get_values` across range `A1:BB50`.
3. Extract Vehicle Context from header cells `E5:N6` or Column L labels (e.g., "2024 Porsche 911 992", VIN in cell E6 or notes).
4. **VIN ENRICHMENT (Optional):** If a 17-character VIN is present in the header cells or notes, call `partstech_decode_vin` with `vin` to lock in the exact Year, Make, Model, Submodel, and Engine specs.

### Step 3: Identify Blank Rows & Audit Description Accuracy
Examine rows 10 through 45:
- Identify rows where Column N ("ITEM / SERVICE DESCRIPTION") has a part requested AND:
  a) Column L ("PART NUMBER") is blank or empty, OR
  b) Column AK ("LIST $ EA") is blank or empty.
- **INACCURACY AUDIT:** Determine if the requested finish/spec exists in factory OEM or aftermarket availability (e.g., customer requests "Chrome Rims" when only factory Alloy or Satin finishes exist).

---

### Step 4: The Row Cloning & Formatting Protocol (Preserves Formulas & Checkboxes)
If an item is inaccurately described or requires a factory alternative:
1. **Preserve Customer Request:**
   - Format original row's Column N text to **BOLD**.
   - Leave Column L, Column T, and Column AK BLANK on this customer row. Do not alter its formulas.
2. **Clone the Row (Do NOT leave it blank):**
   - Call `insert_dimension` to insert 1 row immediately below the customer row.
   - Execute a `copyPaste` command via `update_spreadsheet`:
     • Source: Customer row above.
     • Destination: Newly inserted row.
     • `pasteType`: **PASTE_NORMAL** (Duplicates all formulas, EXTEN math, checkboxes, and styling!).

---

### Step 5: PartsTech Procurement Lookup
For each target row (standard rows and newly inserted cloned rows):
1. Call `partstech_search_parts` with:
   - `keyword`: "[Description]" (e.g., "water pump", "oil cooler", "brake pads").
   - `part_number`: Part number if provided in Column L or description.
   - `vin`: 17-character VIN if identified in Step 2.
2. From the PartsTech response, extract:
   - Part Number & Normalized Part Description
   - Brand / Manufacturer Name (e.g., "BOSCH", "BREMBO", "BILSTEIN", "OEM")
   - Dealer Wholesale Buy Cost
   - Retail / MSRP List Price
   - Connected Distributor Name (e.g., "TURN14", "WORLDPAC", "SSF")
   - Warehouse availability / quantity in stock.

---

### Step 6: Targeted Sheet Population (Client Side & Admin VEN A)
Write values using `update_values` and `update_spreadsheet`:

**CLIENT-SIDE COLUMNS (Cols A → Z):**
1. **Column L (PART NUMBER):** Write RAW PLAIN TEXT part number (NO HYPERLINKS).
2. **Column N (DESCRIPTION):** Write clean, accurate part description.
3. **Column N (CELL NOTE):** Attach a Cell Note containing fitment notes and procurement references:
   `Notes: [Fitment / finish alternative details if applicable]`
   `Sourced via PartsTech | Supplier: [SUPPLIER_NAME] | Part #: [PART_NUMBER]`
4. **Column P (MANUFACTURER):** Write manufacturer/brand name:
   • If factory original, write "OEM" or "GENUINE PORSCHE".
   • If aftermarket, write the specific brand returned by PartsTech (e.g., "BILSTEIN", "BREMBO", "BOSCH", "CSF", "MAHLE").
5. **Column AK (LIST $ EA):** Write Retail List Price / MSRP.
6. **Column T (EPW EACH):** Write Wholesale Buy Cost.

**ADMIN-SIDE VENDOR COLUMNS (VEN A):**
7. **Column AZ (VEN A QTY):** Write requested quantity (default 1) or available stock count.
8. **Column BA (VEN A VENDOR):** Write the specific distributor returned by PartsTech (e.g., `TURN14`, `WORLDPAC`, or `PARTSTECH`).
9. **Column BB (VEN A COST EA):** Write Dealer Wholesale Buy Cost.

---

### Step 7: Confirmation Summary Report
Output a clean markdown table in chat:
- Document Updated & Vehicle Identified (including decoded VIN specs if used).
- Table Columns: Row # | Description | Part # | Brand | Wholesale (T & BB) | List Price (AK) | Sourced Vendor (BA) | Stock Status