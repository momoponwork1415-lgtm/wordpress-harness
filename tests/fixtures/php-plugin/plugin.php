<?php

add_action('rest_api_init', 'demo_register_routes');

function demo_register_routes(): void
{
    register_rest_route('demo/v1', '/items', [
        'methods' => 'POST',
        'callback' => 'demo_update_item',
        'permission_callback' => static function (): bool {
            return current_user_can('edit_posts');
        },
    ]);
}

function demo_update_item(WP_REST_Request $request): string
{
    $name = $request->get_param('name');
    update_option('demo_name', $name);
    return esc_html($name);
}
