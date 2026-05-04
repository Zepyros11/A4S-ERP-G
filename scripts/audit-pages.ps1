$ErrorActionPreference = 'Stop'
$root = "d:\@Projects\A4S-ERP-G"
$modulesDir = Join-Path $root "modules"
$outDir = Join-Path $root "docs\audit"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$files = Get-ChildItem -Path $modulesDir -Recurse -Filter '*.html' -File | Sort-Object FullName

$rows = @()
foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1).Replace('\','/')
  $text = Get-Content -Raw -LiteralPath $f.FullName
  $textNoComments = [regex]::Replace($text, '<!--[\s\S]*?-->', '')

  $cssLinks = ([regex]::Matches($textNoComments, '<link[^>]*href="([^"]+\.css)"')) | ForEach-Object { $_.Groups[1].Value }
  $jsLinks  = ([regex]::Matches($textNoComments, '<script[^>]*src="([^"]+\.js)"')) | ForEach-Object { $_.Groups[1].Value }

  function HasFile($list, $needle) { ($list | Where-Object { $_ -match [regex]::Escape($needle) }).Count -gt 0 }

  $row = [ordered]@{
    file              = $rel
    isPortal          = $rel -like 'modules/ibd-portal/*'
    cssCount          = $cssLinks.Count
    jsCount           = $jsLinks.Count
    importsMainCss    = (HasFile $cssLinks 'css/main.css')
    importsModuleCss  = (($cssLinks | Where-Object { $_ -notlike '*/css/*' -and $_ -notlike 'http*' }).Count -gt 0)
    importsModalCss   = (HasFile $cssLinks 'modal.css')
    importsTableCss   = (HasFile $cssLinks 'table.css')
    importsImgGridCss = (HasFile $cssLinks 'imageGrid.css')
    hasModalManager   = (HasFile $jsLinks 'modalManager.js')
    hasConfirmModal   = (HasFile $jsLinks 'confirmModal.js')
    hasPromptModal    = (HasFile $jsLinks 'promptModal.js')
    hasAuth           = (HasFile $jsLinks 'auth.js')
    hasAuthz          = (HasFile $jsLinks 'authz.js')
    hasPermissions    = (HasFile $jsLinks 'permissions.js')
    hasSidebar        = (HasFile $jsLinks 'sidebar.js')
    hasTopbarJs       = (HasFile $jsLinks 'topbar.js')
    hasDateFormat     = (HasFile $jsLinks 'date-format.js')
    hasTopbarMarkup   = $textNoComments -match '<div[^>]*class="[^"]*topbar'
    hasLayoutShell    = $textNoComments -match '<div[^>]*class="[^"]*layout'
    hasSidebarSlot    = $textNoComments -match 'id="sidebar-container"'
    hasContentArea    = $textNoComments -match 'class="[^"]*content-area'
    hasPageWrap       = $textNoComments -match 'class="[^"]*\bpage\b'
    hasToastEl        = $textNoComments -match 'id="toast"'
    hasLoadingOverlay = $textNoComments -match 'id="loadingOverlay"'
    hasDomLoaded      = $textNoComments -match 'DOMContentLoaded'
    nativeAlert       = ([regex]::Matches($textNoComments, '(?<![A-Za-z_$.])alert\s*\(')).Count
    nativeConfirm     = ([regex]::Matches($textNoComments, '(?<![A-Za-z_$.])confirm\s*\(')).Count
    nativePrompt      = ([regex]::Matches($textNoComments, '(?<![A-Za-z_$.])prompt\s*\(')).Count
    moduleCssList     = ($cssLinks | Where-Object { $_ -notlike '*/css/*' -and $_ -notlike 'http*' }) -join ';'
  }
  $rows += [pscustomobject]$row
}

$jsonPath = Join-Path $outDir 'pages-audit.json'
$rows | ConvertTo-Json -Depth 4 | Out-File -FilePath $jsonPath -Encoding utf8

# ---- Build markdown report ----
$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine("# Page audit (auto-generated)")
[void]$md.AppendLine("")
[void]$md.AppendLine("Total HTML pages scanned: **$($rows.Count)**")
[void]$md.AppendLine("")

# Internal vs portal split
$internal = $rows | Where-Object { -not $_.isPortal }
$portal   = $rows | Where-Object { $_.isPortal }
[void]$md.AppendLine("- Internal pages: **$($internal.Count)**")
[void]$md.AppendLine("- Portal pages (ibd-portal): **$($portal.Count)**")
[void]$md.AppendLine("")

function Section($title, $list) {
  param()
}

[void]$md.AppendLine("## Summary by criterion (internal pages only)")
[void]$md.AppendLine("")
[void]$md.AppendLine("| Criterion | Has | Missing |")
[void]$md.AppendLine("|---|---:|---:|")
$crit = @(
  @('imports css/main.css',  'importsMainCss'),
  @('has modalManager.js',   'hasModalManager'),
  @('has auth.js',           'hasAuth'),
  @('has authz.js',          'hasAuthz'),
  @('has permissions.js',    'hasPermissions'),
  @('has sidebar.js',        'hasSidebar'),
  @('has date-format.js',    'hasDateFormat'),
  @('has topbar markup',     'hasTopbarMarkup'),
  @('has layout shell',      'hasLayoutShell'),
  @('has sidebar slot',      'hasSidebarSlot'),
  @('has content-area',      'hasContentArea'),
  @('has page wrap',         'hasPageWrap'),
  @('has toast element',     'hasToastEl'),
  @('has loading overlay',   'hasLoadingOverlay'),
  @('has DOMContentLoaded',  'hasDomLoaded')
)
foreach ($c in $crit) {
  $has = ($internal | Where-Object { $_.($c[1]) }).Count
  $missing = $internal.Count - $has
  [void]$md.AppendLine("| $($c[0]) | $has | $missing |")
}
[void]$md.AppendLine("")

[void]$md.AppendLine("## Drift: pages MISSING required pieces (internal)")
[void]$md.AppendLine("")
$checks = @(
  @('Missing main.css',      { -not $_.importsMainCss }),
  @('Missing modalManager',  { -not $_.hasModalManager }),
  @('Missing auth.js',       { -not $_.hasAuth }),
  @('Missing authz.js',      { -not $_.hasAuthz }),
  @('Missing sidebar.js',    { -not $_.hasSidebar }),
  @('Missing topbar markup', { -not $_.hasTopbarMarkup }),
  @('Missing layout shell',  { -not $_.hasLayoutShell }),
  @('Missing toast element', { -not $_.hasToastEl }),
  @('Native alert used',     { $_.nativeAlert -gt 0 }),
  @('Native confirm used',   { $_.nativeConfirm -gt 0 }),
  @('Native prompt used',    { $_.nativePrompt -gt 0 })
)
foreach ($c in $checks) {
  $hits = $internal | Where-Object $c[1]
  [void]$md.AppendLine("### $($c[0]) — $($hits.Count) page(s)")
  if ($hits.Count -eq 0) { [void]$md.AppendLine("_none_") }
  else {
    foreach ($h in $hits) { [void]$md.AppendLine("- ``$($h.file)``") }
  }
  [void]$md.AppendLine("")
}

[void]$md.AppendLine("## Per-page table (internal)")
[void]$md.AppendLine("")
[void]$md.AppendLine("Legend: M=main.css · m=modalMgr · a=auth · z=authz · p=perm · s=sidebar · T=topbar markup · L=layout · A=alert · C=confirm")
[void]$md.AppendLine("")
[void]$md.AppendLine("| File | M | m | a | z | p | s | T | L | A | C | module css |")
[void]$md.AppendLine("|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|")
function YN($b) { if ($b) { '✓' } else { '·' } }
function NZ($n) { if ($n -gt 0) { "$n" } else { '·' } }
foreach ($r in $internal) {
  $line = "| $($r.file) | $(YN $r.importsMainCss) | $(YN $r.hasModalManager) | $(YN $r.hasAuth) | $(YN $r.hasAuthz) | $(YN $r.hasPermissions) | $(YN $r.hasSidebar) | $(YN $r.hasTopbarMarkup) | $(YN $r.hasLayoutShell) | $(NZ $r.nativeAlert) | $(NZ $r.nativeConfirm) | $($r.moduleCssList) |"
  [void]$md.AppendLine($line)
}

$mdPath = Join-Path $outDir 'pages-audit.md'
$md.ToString() | Out-File -FilePath $mdPath -Encoding utf8

Write-Output "wrote: $jsonPath"
Write-Output "wrote: $mdPath"
Write-Output "internal: $($internal.Count) | portal: $($portal.Count)"
