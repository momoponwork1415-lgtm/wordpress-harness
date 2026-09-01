<?php

function demo_with_error(): void
{
    $value = get_option('demo_name')
    echo esc_html($value);
}
