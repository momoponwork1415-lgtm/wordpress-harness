#!/usr/bin/env php
<?php

declare(strict_types=1);

use WordPressHarness\PhpProgramIndex\ProgramIndexer;

require dirname(__DIR__) . '/vendor/autoload.php';

try {
    $requestJson = stream_get_contents(STDIN);
    if ($requestJson === false) {
        throw new RuntimeException('Unable to read request from stdin');
    }

    $request = json_decode($requestJson, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($request)) {
        throw new InvalidArgumentException('Request must be a JSON object');
    }

    $index = (new ProgramIndexer())->build($request);
    $response = json_encode($index, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "\n";
    echo $response;
} catch (Throwable $error) {
    error_log($error::class . ': ' . $error->getMessage());
    exit(1);
}
