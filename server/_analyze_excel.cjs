const ExcelJS = require('exceljs');

async function analyze() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('/Users/pedrofasting/Downloads/Test Herjedal.xlsx');

  console.log(`=== WORKBOOK: Test Herjedal.xlsx ===`);
  console.log(`Total sheets: ${workbook.worksheets.length}`);
  console.log(`Sheet names: ${workbook.worksheets.map(s => s.name).join(', ')}\n`);

  for (const sheet of workbook.worksheets) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SHEET: "${sheet.name}"`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Rows: ${sheet.rowCount}, Columns: ${sheet.columnCount}`);
    console.log(`Actual row range: ${sheet.dimensions?.top || '?'} to ${sheet.dimensions?.bottom || '?'}`);
    console.log(`Actual col range: ${sheet.dimensions?.left || '?'} to ${sheet.dimensions?.right || '?'}`);

    // Print column letters for reference
    const maxCol = sheet.columnCount;
    const colLetters = [];
    for (let c = 1; c <= maxCol; c++) {
      let letter = '';
      let n = c;
      while (n > 0) {
        n--;
        letter = String.fromCharCode(65 + (n % 26)) + letter;
        n = Math.floor(n / 26);
      }
      colLetters.push(letter);
    }

    console.log(`\nColumn headers (letters): ${colLetters.join(' | ')}\n`);

    // Print first 40 rows
    const maxRows = Math.min(sheet.rowCount, 40);
    for (let r = 1; r <= maxRows; r++) {
      const row = sheet.getRow(r);
      const values = [];
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        let val = cell.value;

        // Handle formula cells - show the result
        if (val && typeof val === 'object') {
          if (val.formula || val.sharedFormula) {
            const formula = val.formula || val.sharedFormula;
            const result = val.result;
            val = result !== undefined && result !== null ? result : `[FORMULA: ${formula}]`;
          } else if (val.richText) {
            val = val.richText.map(rt => rt.text).join('');
          } else if (val instanceof Date) {
            val = val.toISOString().split('T')[0];
          } else {
            val = JSON.stringify(val);
          }
        }

        // Format numbers nicely
        if (typeof val === 'number') {
          if (Number.isInteger(val)) {
            val = val.toString();
          } else {
            val = val.toFixed(2);
          }
        }

        values.push(val !== null && val !== undefined ? String(val) : '');
      }

      // Check if row is completely empty
      const isEmpty = values.every(v => v === '');
      if (isEmpty) {
        console.log(`Row ${String(r).padStart(3)}: [empty]`);
      } else {
        console.log(`Row ${String(r).padStart(3)}: ${values.map((v, i) => `${colLetters[i]}="${v}"`).join(' | ')}`);
      }
    }

    if (sheet.rowCount > 40) {
      console.log(`\n... (${sheet.rowCount - 40} more rows not shown)`);
    }

    // Check for merged cells
    const merges = sheet.model.merges || [];
    if (merges.length > 0) {
      console.log(`\nMerged cells (${merges.length}):`);
      merges.forEach(m => console.log(`  ${m}`));
    }
  }
}

analyze().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
