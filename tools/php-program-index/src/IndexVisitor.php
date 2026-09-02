<?php

declare(strict_types=1);

namespace WordPressHarness\PhpProgramIndex;

use PhpParser\Node;
use PhpParser\Node\Expr;
use PhpParser\Node\Name;
use PhpParser\Node\Stmt;
use PhpParser\NodeVisitorAbstract;

final class IndexVisitor extends NodeVisitorAbstract
{
    /** @var list<array<string, mixed>> */
    private array $symbols = [];

    /** @var list<array<string, mixed>> */
    private array $calls = [];

    /** @var list<array<string, mixed>> */
    private array $wordpressFacts = [];

    /** @var list<string> */
    private array $classStack = [];

    /** @var list<string> */
    private array $callableStack = [];

    public function enterNode(Node $node): null
    {
        if ($node instanceof Stmt\Class_
            || $node instanceof Stmt\Interface_
            || $node instanceof Stmt\Trait_
            || $node instanceof Stmt\Enum_
        ) {
            $name = $this->declarationName($node);
            if ($name !== null) {
                $this->symbols[] = [
                    'kind' => $this->classLikeKind($node),
                    'name' => $name,
                    'range' => $this->range($node),
                ];
                $this->classStack[] = $name;
            } else {
                $this->classStack[] = 'anonymous-class@' . $node->getStartLine();
            }
        } elseif ($node instanceof Stmt\Function_) {
            $name = $this->declarationName($node) ?? $node->name->toString();
            $this->symbols[] = [
                'kind' => 'function',
                'name' => $name,
                'range' => $this->range($node),
            ];
            $this->callableStack[] = $name;
        } elseif ($node instanceof Stmt\ClassMethod) {
            $class = $this->last($this->classStack) ?? 'unknown-class';
            $name = $class . '::' . $node->name->toString();
            $this->symbols[] = [
                'kind' => 'method',
                'name' => $name,
                'range' => $this->range($node),
            ];
            $this->callableStack[] = $name;
        } elseif ($node instanceof Expr\Closure || $node instanceof Expr\ArrowFunction) {
            $this->callableStack[] = 'closure@' . $node->getStartLine();
        }

        $call = $this->callRecord($node);
        if ($call !== null) {
            $this->calls[] = $call;
        }

        if ($node instanceof Expr\FuncCall && $node->name instanceof Name) {
            $this->recordWordPressRegistration($node, $node->name->toString());
        }

        $this->recordSecurityFact($node);

        return null;
    }

    public function leaveNode(Node $node): null
    {
        if ($node instanceof Stmt\Function_
            || $node instanceof Stmt\ClassMethod
            || $node instanceof Expr\Closure
            || $node instanceof Expr\ArrowFunction
        ) {
            array_pop($this->callableStack);
        }

        if ($node instanceof Stmt\Class_
            || $node instanceof Stmt\Interface_
            || $node instanceof Stmt\Trait_
            || $node instanceof Stmt\Enum_
        ) {
            array_pop($this->classStack);
        }

        return null;
    }

    /** @return list<array<string, mixed>> */
    public function symbols(): array
    {
        return $this->sorted($this->symbols);
    }

    /** @return list<array<string, mixed>> */
    public function calls(): array
    {
        return $this->sorted($this->calls);
    }

    /** @return list<array<string, mixed>> */
    public function wordpressFacts(): array
    {
        return $this->sorted($this->wordpressFacts);
    }

    /** @return array<string, mixed>|null */
    private function callRecord(Node $node): ?array
    {
        $kind = null;
        $callee = null;

        if ($node instanceof Expr\FuncCall) {
            $kind = $node->name instanceof Name ? 'function' : 'dynamic';
            $callee = $node->name instanceof Name ? $node->name->toString() : null;
        } elseif ($node instanceof Expr\MethodCall || $node instanceof Expr\NullsafeMethodCall) {
            $kind = $node->name instanceof Node\Identifier ? 'method' : 'dynamic';
            $callee = $node->name instanceof Node\Identifier ? $node->name->toString() : null;
        } elseif ($node instanceof Expr\StaticCall) {
            $kind = $node->class instanceof Name && $node->name instanceof Node\Identifier
                ? 'static'
                : 'dynamic';
            $callee = $node->class instanceof Name && $node->name instanceof Node\Identifier
                ? $node->class->toString() . '::' . $node->name->toString()
                : null;
        }

        if ($kind === null) {
            return null;
        }

        return [
            'kind' => $kind,
            'caller' => $this->last($this->callableStack),
            'callee' => $callee,
            'range' => $this->range($node),
        ];
    }

    private function recordWordPressRegistration(Expr\FuncCall $call, string $callee): void
    {
        $normalized = strtolower(ltrim($callee, '\\'));
        if ($normalized === 'add_action' || $normalized === 'add_filter') {
            $this->wordpressFacts[] = [
                'kind' => 'hook-registration',
                'hook' => $this->stringArgument($call, 0),
                'callback' => $this->callableArgument($call, 1),
                'range' => $this->range($call),
            ];
            return;
        }

        if ($normalized !== 'register_rest_route') {
            return;
        }

        $options = $call->getArgs()[2]->value ?? null;
        $this->wordpressFacts[] = [
            'kind' => 'route-registration',
            'namespace' => $this->stringArgument($call, 0),
            'route' => $this->stringArgument($call, 1),
            'callback' => $options instanceof Expr\Array_
                ? $this->arrayCallable($options, 'callback')
                : null,
            'permissionCallback' => $options instanceof Expr\Array_
                ? $this->arrayCallable($options, 'permission_callback')
                : null,
            'range' => $this->range($call),
        ];
    }

    private function recordSecurityFact(Node $node): void
    {
        if ($node instanceof Expr\Eval_) {
            $this->wordpressFacts[] = [
                'kind' => 'sink',
                'category' => 'code-execution',
                'operation' => 'eval',
                'range' => $this->range($node),
            ];
            return;
        }

        if ($node instanceof Expr\Include_) {
            $operation = match ($node->type) {
                Expr\Include_::TYPE_INCLUDE => 'include',
                Expr\Include_::TYPE_INCLUDE_ONCE => 'include_once',
                Expr\Include_::TYPE_REQUIRE => 'require',
                Expr\Include_::TYPE_REQUIRE_ONCE => 'require_once',
            };
            $this->wordpressFacts[] = [
                'kind' => 'sink',
                'category' => 'code-execution',
                'operation' => $operation,
                'range' => $this->range($node),
            ];
            return;
        }

        if ($node instanceof Stmt\Echo_) {
            $this->wordpressFacts[] = [
                'kind' => 'sink',
                'category' => 'html-output',
                'operation' => 'echo',
                'range' => $this->range($node),
            ];
            return;
        }

        if ($node instanceof Expr\Variable
            && is_string($node->name)
            && in_array($node->name, ['_GET', '_POST', '_REQUEST', '_COOKIE', '_FILES'], true)
        ) {
            $this->wordpressFacts[] = [
                'kind' => 'source',
                'category' => 'request-superglobal',
                'operation' => $node->name,
                'range' => $this->range($node),
            ];
            return;
        }

        if ($node instanceof Expr\MethodCall
            && $node->var instanceof Expr\Variable
            && $node->var->name === 'wpdb'
            && $node->name instanceof Node\Identifier
        ) {
            $operation = strtolower($node->name->toString());
            if (in_array($operation, ['query', 'get_var', 'get_row', 'get_col', 'get_results'], true)) {
                $this->wordpressFacts[] = [
                    'kind' => 'sink',
                    'category' => 'database-query',
                    'operation' => $operation,
                    'range' => $this->range($node),
                ];
                return;
            }
        }

        if ($node instanceof Expr\MethodCall
            && $node->name instanceof Node\Identifier
            && strtolower($node->name->toString()) === 'get_param'
        ) {
            $this->wordpressFacts[] = [
                'kind' => 'source',
                'category' => 'request-parameter',
                'operation' => 'get_param',
                'range' => $this->range($node),
            ];
            return;
        }

        if (!$node instanceof Expr\FuncCall || !$node->name instanceof Name) {
            return;
        }

        $operation = strtolower(ltrim($node->name->toString(), '\\'));
        if ($operation === 'file_put_contents') {
            $this->wordpressFacts[] = [
                'kind' => 'sink',
                'category' => 'filesystem-write',
                'operation' => $operation,
                'range' => $this->range($node),
            ];
            return;
        }

        if (in_array($operation, ['exec', 'system', 'passthru', 'shell_exec', 'popen', 'proc_open', 'pcntl_exec'], true)) {
            $this->wordpressFacts[] = [
                'kind' => 'sink',
                'category' => 'process-execution',
                'operation' => $operation,
                'range' => $this->range($node),
            ];
            return;
        }

        if ($operation === 'current_user_can') {
            $this->wordpressFacts[] = [
                'kind' => 'guard',
                'category' => 'authorization',
                'operation' => $operation,
                'range' => $this->range($node),
            ];
            return;
        }

        $access = match ($operation) {
            'get_option' => 'read',
            'update_option' => 'write',
            default => null,
        };
        if ($access !== null) {
            $this->wordpressFacts[] = [
                'kind' => 'storage',
                'category' => 'option',
                'operation' => $operation,
                'access' => $access,
                'range' => $this->range($node),
            ];
        }
    }

    private function stringArgument(Expr\FuncCall $call, int $position): ?string
    {
        $value = $call->getArgs()[$position]->value ?? null;
        return $value instanceof Node\Scalar\String_ ? $value->value : null;
    }

    private function callableArgument(Expr\FuncCall $call, int $position): ?string
    {
        $value = $call->getArgs()[$position]->value ?? null;
        return $value instanceof Expr ? $this->callableValue($value) : null;
    }

    private function arrayCallable(Expr\Array_ $array, string $key): ?string
    {
        foreach ($array->items as $item) {
            if ($item === null || !$item->key instanceof Node\Scalar\String_) {
                continue;
            }
            if ($item->key->value === $key) {
                return $this->callableValue($item->value);
            }
        }
        return null;
    }

    private function callableValue(Expr $value): ?string
    {
        if ($value instanceof Node\Scalar\String_) {
            return $value->value;
        }
        if ($value instanceof Expr\Closure || $value instanceof Expr\ArrowFunction) {
            return 'closure';
        }
        if ($value instanceof Expr\Array_ && count($value->items) === 2) {
            $first = $value->items[0]?->value;
            $second = $value->items[1]?->value;
            $class = $first instanceof Node\Scalar\String_ ? $first->value : null;
            $method = $second instanceof Node\Scalar\String_ ? $second->value : null;
            return $class !== null && $method !== null ? $class . '::' . $method : null;
        }
        return null;
    }

    private function declarationName(Node $node): ?string
    {
        $name = $node->getAttribute('namespacedName');
        if ($name instanceof Name) {
            return $name->toString();
        }
        if (property_exists($node, 'namespacedName') && $node->namespacedName instanceof Name) {
            return $node->namespacedName->toString();
        }
        if (property_exists($node, 'name') && $node->name instanceof Node\Identifier) {
            return $node->name->toString();
        }
        return null;
    }

    private function classLikeKind(Node $node): string
    {
        return match (true) {
            $node instanceof Stmt\Class_ => 'class',
            $node instanceof Stmt\Interface_ => 'interface',
            $node instanceof Stmt\Trait_ => 'trait',
            $node instanceof Stmt\Enum_ => 'enum',
            default => throw new \LogicException('Not a class-like node'),
        };
    }

    /** @return array{startLine: int, endLine: int, startOffset: int, endOffset: int} */
    private function range(Node $node): array
    {
        return [
            'startLine' => max(1, $node->getStartLine()),
            'endLine' => max(1, $node->getEndLine()),
            'startOffset' => max(0, $node->getStartFilePos()),
            'endOffset' => max(0, $node->getEndFilePos()),
        ];
    }

    /** @param list<string> $values */
    private function last(array $values): ?string
    {
        $value = end($values);
        return $value === false ? null : $value;
    }

    /**
     * @param list<array<string, mixed>> $records
     * @return list<array<string, mixed>>
     */
    private function sorted(array $records): array
    {
        usort($records, static function (array $left, array $right): int {
            $leftRange = $left['range'];
            $rightRange = $right['range'];
            return [$leftRange['startOffset'], $left['kind'], $left['name'] ?? $left['callee'] ?? '']
                <=> [$rightRange['startOffset'], $right['kind'], $right['name'] ?? $right['callee'] ?? ''];
        });
        return $records;
    }
}
