<?php

function run_search(string $sql): array
{
    global $wpdb;

    $wpdb->query($sql);
    $wpdb->get_var($sql);
    $wpdb->get_row($sql);
    $wpdb->get_col($sql);
    return $wpdb->get_results($sql);
}

function save_export(string $path, string $contents): void
{
    file_put_contents($path, $contents);
}

function evaluate_code(string $code): mixed
{
    return eval($code);
}

function load_extensions(string $path): void
{
    include $path;
    include_once $path;
    require $path;
    require_once $path;
}

function run_command(string $command): string
{
    exec($command);
    system($command);
    passthru($command);
    popen($command, 'r');
    proc_open($command, [], $pipes);
    pcntl_exec($command);
    return shell_exec($command) ?? '';
}

function run_non_wordpress_query(object $client, string $sql): mixed
{
    return $client->query($sql);
}
