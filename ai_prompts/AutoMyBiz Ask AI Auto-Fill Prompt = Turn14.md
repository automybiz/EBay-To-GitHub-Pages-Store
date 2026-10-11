# Auto-Fill Invoice Parts, Pricing & Admin Sourcing (Turn14 Production Edition)

## Configuration Variables
- DEFAULT_INVOICE_FOLDER_ID: "1KUGc5eo8ukAH17nNx57fkFQMsLS4Qiig"
- DEFAULT_VENDOR_NAME: "TURN14"

---

## Supported User Prompt Templates (Few-Shot Training Examples)
The agent must recognize and parse any of the following input formats from shop staff:

### Template 1: Direct Google Sheet URL
"Do Turn14 Auto-Fill for Sheet ID in the URL... 
https://docs.google.com/spreadsheets/d/1qVnh741--LaOh2l6BVy5KvzkZ9-BzsMHVVKh3ouaXU8/edit?gid=395041514#gid=395041514"
-> Execution: Extract `spreadsheetId` ("1qVnh741--LaOh2l6BVy5KvzkZ9-BzsMHVVKh3ouaXU8") and `gid` tab directly. Skip Drive search entirely.

### Template 2: Invoice Number + Custom Folder ID
"Do Turn14 Auto-Fill for Sheet with Invoice # 260915-1 in Folder ID... 
1KUGc5eo8ukAH17nNx57fkFQMsLS4Qiig"
-> Execution: Search Drive specifically inside parent folder `1KUGc5eo8ukAH17nNx57fkFQMsLS4Qiig` for filename containing "260915-1".

### Template 3: Invoice Number Alone (Uses Default Folder ID)
"Do Turn14 Auto-Fill for Sheet with Invoice # 260915-1"
-> Execution: Automatically use `DEFAULT_INVOICE_FOLDER_ID` ("1KUGc5eo8ukAH17nNx57fkFQMsLS4Qiig") in parents and search for "260915-1".

### Template 4: Customer Name + Invoice Number
"Do Turn14 Auto-Fill for Brian Yoda's Porsche Invoice # 260915-1"
-> Execution: Locate sheet for invoice "260915-1", confirm customer "Brian Yoda" in header cell E5, and proceed.

---

## Required Connectors & Strict Constraints
- **Google Drive MCP:** Locate files within `DEFAULT_INVOICE_FOLDER_ID` or user-specified folder.
- **Google Sheets MCP:** Inspect ('get_values', 'get_spreadsheet'), duplicate rows ('insert_dimension', 'update_spreadsheet' with copyPaste), and write values ('update_values').
- **Turn14 Distrubution MCP:** Sole wholesale parts source.
- **STRICT VENDOR TUNNEL VISION:** When prompt specifies "Turn14", ONLY query Turn14 MCP. Do NOT query Google Search or other suppliers unless user explicitly commands fallback.
- **CLIENT-SIDE PRIVACY RULE:** Never put interactive hyperlinks in Column L. Column L must be RAW PLAIN TEXT to protect Day's tradecraft. All product URLs belong in Column N's Cell Note.
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
3. Extract Vehicle Context from header cells `E5:N6` or Column L labels (e.g., "2024 Porsche 911 992").

### Step 3: Identify Blank Rows & Audit Description Accuracy
Examine rows 10 through 45:
- Identify rows where Column N ("ITEM / SERVICE DESCRIPTION") has a part requested AND:
  a) Column L ("PART NUMBER") is blank or empty, OR
  b) Column AK ("LIST $ EA") is blank or empty.
- **INACCURACY AUDIT:** Determine if the requested finish/spec exists in Turn14/factory OEM (e.g., customer asks for "Chrome Rims" when only factory Alloy finishes exist).

---

### Step 4: The Row Cloning & Formatting Protocol (Preserves Formulas & Checkboxes)
If an item is inaccurately described:
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

### Step 5: Turn14 Procurement Lookup (Tunnel Vision)
For each target row (standard rows and newly inserted cloned rows):
1. Call `turn14_search_items` with: `[Vehicle Year Make Model] [Description]`.
2. Extract top matching item ID, Manufacturer Part Number, and Brand Name.
3. Call `turn14_get_pricing_and_stock` with the `item_id` to retrieve:
   - Dealer Wholesale Buy Cost
   - Retail / MSRP Price
   - Warehouse stock counts (Reno, NV and Arlington, TX).
   - Exact Turn14 product landing URL.

---

### Step 6: Targeted Sheet Population (Client Side & Admin VEN A)
Write values using `update_values` and `update_spreadsheet`:

**CLIENT-SIDE COLUMNS (Cols A → Z):**
1. **Column L (PART NUMBER):** Write RAW PLAIN TEXT part number (NO HYPERLINKS).
2. **Column N (DESCRIPTION):** Write accurate description.
3. **Column N (CELL NOTE):** Attach a Cell Note containing the exact Turn14 deep product URL and fitment notes:
   `Notes.. not [customer requested finish]. Factory option: [option name].`
   `Turn14 SKU / Link: [FULL_DEEP_TURN14_URL]`
4. **Column P (MANUFACTURER):** Write the manufacturer/brand name:
   • If sourced as factory original, write "OEM" or "GENUINE PORSCHE".
   • If sourced from Turn14, write the specific brand name returned by the API (e.g., "BILSTEIN", "BREMBO", "BOSCH", "CSF").
5. **Column AK (LIST $ EA):** Write Retail List Price.
6. **Column T (EPW EACH):** Write Wholesale Buy Cost.

**ADMIN-SIDE VENDOR COLUMNS (VEN A):**
7. **Column AZ (VEN A QTY):** Write requested quantity (default 1) or available stock count.
8. **Column BA (VEN A VENDOR):** Write `TURN14` (matches Day's dropdown menu).
9. **Column BB (VEN A COST EA):** Write Dealer Wholesale Buy Cost from Turn14.

---

### Step 7: Confirmation Summary Report
Output a clean markdown table in chat:
- Document Updated & Vehicle Identified.
- Columns: Row # | Description | Part # | Brand | Wholesale (T & BB) | List Price (AK) | Reno/Arlington Stock | VEN A Status