<?php
$vars = ['APP_ENV','APP_DEBUG','APP_URL','DB_CONNECTION','DB_HOST','DB_DATABASE','CACHE_DRIVE','QUEUE_CONNECTION'];
$out = [];
foreach ($vars as $v) { $out[$v] = getenv($v) ?: null; }
echo json_encode($out, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);
