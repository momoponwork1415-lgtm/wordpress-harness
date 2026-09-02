<?php

function update_profile(): void
{
    $query = $_GET['query'];
    $displayName = $_POST['display_name'];
    $action = $_REQUEST['action'];
    $session = $_COOKIE['session'];
    $upload = $_FILES['upload'];
}

function raw_payload(): array
{
    return $_POST;
}
