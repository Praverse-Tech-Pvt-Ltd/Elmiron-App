# W1-N A3 -- builds territory-template.xlsx FROM Territories.csv and MRs.csv in this folder.
#
# The workbook is generated, never hand-edited, so the rows the operator sees are the rows
# services/api/tests/territory-sheet.spec.ts checks. No dependency: an .xlsx is a zip of XML parts,
# and .NET's System.IO.Compression writes one. Run from this folder:
#   powershell -ExecutionPolicy Bypass -File build-xlsx.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out  = Join-Path (Split-Path -Parent $here) 'territory-template.xlsx'

function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }

function Col([int]$i) { [string][char](65 + $i) }

function SheetXml([string[][]]$rows) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  [void]$sb.Append('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>')
  for ($r = 0; $r -lt $rows.Count; $r++) {
    [void]$sb.Append("<row r=`"$($r + 1)`">")
    for ($c = 0; $c -lt $rows[$r].Count; $c++) {
      $ref = "$(Col $c)$($r + 1)"
      [void]$sb.Append("<c r=`"$ref`" t=`"inlineStr`"><is><t xml:space=`"preserve`">$(Esc $rows[$r][$c])</t></is></c>")
    }
    [void]$sb.Append('</row>')
  }
  [void]$sb.Append('</sheetData></worksheet>')
  $sb.ToString()
}

function CsvRows([string]$path) {
  # The template CSVs contain no quoted commas, so a plain split is exact for them.
  Get-Content -Path $path -Encoding UTF8 | Where-Object { $_.Trim() -ne '' } | ForEach-Object { ,($_ -split ',', -1) }
}

$readme = @(
  ,@('How to fill this workbook')
  ,@('1. Territories sheet: one row per National, Region and Area/Territory. Columns: level, name, code, parent_code, company.')
  ,@('   level is National, Region, Area or Territory. A National row has no parent_code. A Region''s parent is a National. An Area''s parent is a Region.')
  ,@('   code must be unique across EVERY company, not just yours. parent_code must be a code on this sheet. company is the company name, the same on every row of a company.')
  ,@('2. MRs sheet: one row per medical representative. Columns: name, email, mobile, territory_code, company.')
  ,@('   territory_code must be an Area/Territory row on the Territories sheet, of the same company. Each email once only.')
  ,@('3. DELETE the example rows (codes starting EXAMPLE-) before sending. The checker refuses any row still starting EXAMPLE-.')
  ,@('4. Save each of the two data sheets as CSV (File > Save As > CSV UTF-8) and send both files.')
  ,@('What the checker refuses, by row number: a parent that does not exist; a duplicate code; a missing company;')
  ,@('   a parent in another company; a level that skips a step; an MR on a missing or non-Area territory; a duplicate MR email.')
  ,@('Nothing is loaded until every row passes. MR sign-in accounts are created separately, one per MR row.')
)

$parts = [ordered]@{
  '[Content_Types].xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
  '_rels/.rels' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  'xl/workbook.xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Read me" sheetId="1" r:id="rId1"/><sheet name="Territories" sheetId="2" r:id="rId2"/><sheet name="MRs" sheetId="3" r:id="rId3"/></sheets></workbook>'
  'xl/_rels/workbook.xml.rels' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>'
  'xl/worksheets/sheet1.xml' = (SheetXml $readme)
  'xl/worksheets/sheet2.xml' = (SheetXml (CsvRows (Join-Path $here 'Territories.csv')))
  'xl/worksheets/sheet3.xml' = (SheetXml (CsvRows (Join-Path $here 'MRs.csv')))
}

if (Test-Path $out) { Remove-Item $out -Confirm:$false }
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($name in $parts.Keys) {
    $entry  = $zip.CreateEntry($name)
    $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
    $writer.Write($parts[$name])
    $writer.Dispose()
  }
} finally {
  $zip.Dispose()
}
"Wrote $out"
