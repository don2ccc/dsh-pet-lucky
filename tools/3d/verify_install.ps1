# Assert the DSH profile really links to this repo instead of holding a stale copy.
# A silent copy is what broke a local install once: `ln -s` fell back to a
# recursive copy, so every later edit landed in a folder nobody read.
#
#   powershell -ExecutionPolicy Bypass -File verify_install.ps1
#   powershell -ExecutionPolicy Bypass -File verify_install.ps1 -Profile <profile dir>
param(
    [string]$Profile = "$env:USERPROFILE\.dsh\profiles\desktop",
    [string]$Package = "dsh-pet-lucky",
    [string]$Real = ""
)

if (-not $Real) {
    $Real = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$Link = Join-Path $Profile "node_modules\$Package"
$item = Get-Item $Link -Force -ErrorAction SilentlyContinue
if (-not $item) { throw "MISSING: $Link  (is the plugin registered in this profile?)" }
if ($item.LinkType -notin @('Junction', 'SymbolicLink')) {
    throw "NOT A LINK (it is a real $($item.Attributes) copy): recreate it with New-Item -ItemType Junction"
}
if (-not (Test-Path (Join-Path $Link 'client.js'))) { throw "link does not resolve to client.js" }

$a = (Get-FileHash (Join-Path $Link 'client.js') -Algorithm SHA256).Hash
$b = (Get-FileHash (Join-Path $Real 'client.js') -Algorithm SHA256).Hash
if ($a -ne $b) { throw "STALE: the link resolves to a different client.js than $Real" }

"OK  $($item.LinkType) -> $($item.Target -join ',')"
"OK  client.js $((Get-Item (Join-Path $Link 'client.js')).Length) bytes, hashes match"
