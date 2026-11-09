# Assert the profile really links to the pet instead of holding a stale copy.
# A silent copy is what broke the 3D install twice: `ln -s` fell back to a
# recursive copy, so every install afterwards landed in a folder nobody read.
$Profile = "C:\Users\donnie.gou\.dsh\profiles\desktop"
$Link = Join-Path $Profile "node_modules\dsh-pet-lucky"
$Real = "D:\Donnie\PP\dsh-pet"

$item = Get-Item $Link -Force -ErrorAction SilentlyContinue
if (-not $item) { throw "MISSING: $Link" }
if ($item.LinkType -notin @('Junction','SymbolicLink')) {
    throw "NOT A LINK (it is a $($item.Attributes) copy): recreate with New-Item -ItemType Junction"
}
if (-not (Test-Path (Join-Path $Link 'client.js'))) { throw "link does not resolve to the plugin" }

$a = (Get-FileHash (Join-Path $Link 'client.js') -Algorithm SHA256).Hash
$b = (Get-FileHash (Join-Path $Real 'client.js') -Algorithm SHA256).Hash
if ($a -ne $b) { throw "STALE: link resolves to a different client.js than $Real" }

"OK  $($item.LinkType) -> $($item.Target -join ',')"
"OK  client.js $((Get-Item (Join-Path $Link 'client.js')).Length) bytes, hashes match"
