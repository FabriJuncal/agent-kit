<?php
// php agent/scripts/export_models.php > agent/exports/models.json
// Extrae: FQCN, file, relationships, methods, table, fillable, guarded, casts
$base = __DIR__.'/../../app/Models';
$models = [];

function arr_from_php_array($code, $varName) {
  $re = '/protected\s+\$'.$varName.'\s*=\s*(\[[\s\S]*?\]);/m';
  if (preg_match($re, $code, $m)) {
    $arr = $m[1];
    // extrae strings simples 'foo', "bar"
    preg_match_all('/[\'"]([^\'"]+)[\'"]/', $arr, $mm);
    return array_values(array_unique($mm[1] ?? []));
  }
  return [];
}

if (is_dir($base)) {
  $rii = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base));
  foreach ($rii as $file) {
    if ($file->isFile() && substr($file->getFilename(), -4) === '.php') {
      $path = $file->getPathname();
      $code = file_get_contents($path);
      preg_match('/namespace\s+([^;]+);/m', $code, $ns);
      preg_match('/class\s+(\w+)/m', $code, $cls);
      if (!$cls) continue;
      $fqcn = ($ns[1] ?? 'App\\Models').'\\'.($cls[1]);

      preg_match_all('/function\s+(\w+)\s*\(/', $code, $methods);

      $rels = [];
      foreach (['hasOne','hasMany','belongsTo','belongsToMany','morphOne','morphMany','morphTo'] as $rel) {
        if (str_contains($code, '->'.$rel.'(')) $rels[] = $rel;
      }

      // table
      $table = null;
      if (preg_match('/protected\s+\$table\s*=\s*[\'"]([^\'"]+)[\'"]\s*;/', $code, $m)) {
        $table = $m[1];
      }

      $fillable = arr_from_php_array($code, 'fillable');
      $guarded  = arr_from_php_array($code, 'guarded');

      // casts: parsea claves del array ['foo'=>'datetime', 'bar'=>'int']
      $casts = [];
      if (preg_match('/protected\s+\$casts\s*=\s*(\[[\s\S]*?\]);/m', $code, $m)) {
        $body = $m[1];
        preg_match_all('/[\'"]([^\'"]+)[\'"]\s*=>\s*[\'"]([^\'"]+)[\'"]/', $body, $mm, PREG_SET_ORDER);
        foreach ($mm as $c) $casts[$c[1]] = $c[2];
      }

      $models[] = [
        'class' => $fqcn,
        'file'  => str_replace(getcwd().'/', '', $path),
        'table' => $table,
        'fillable' => $fillable,
        'guarded' => $guarded,
        'casts' => $casts,
        'relationships' => array_values(array_unique($rels)),
        'methods' => $methods[1] ?? [],
      ];
    }
  }
}
echo json_encode(['models'=>$models], JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);
