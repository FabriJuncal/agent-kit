<?php
// php agent/scripts/export_project.php > agent/exports/project_manifest.json
$manifest = [
  'name' => basename(getcwd()),
  'php' => PHP_VERSION,
  'timestamp' => date('c'),
  'apps' => ['laravel' => true],
  'dirs' => array_values(array_filter(glob('*'), fn($d) => is_dir($d) && !in_array($d, ['vendor','node_modules','storage','.git','agent']))),
];
echo json_encode($manifest, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);
