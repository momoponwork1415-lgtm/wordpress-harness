<?php

namespace Demo;

final class AdminPage
{
    public static function render(): void
    {
        echo wp_kses_post((string) get_option('demo_name', ''));
    }
}
