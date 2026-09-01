<?php

declare(strict_types=1);

namespace WordPressHarness\PhpProgramIndex;

use Composer\InstalledVersions;
use PhpParser\Error;
use PhpParser\ErrorHandler\Collecting;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\ParserFactory;
use PhpParser\PhpVersion;
use RecursiveCallbackFilterIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;

final class ProgramIndexer
{
    private const EXCLUDED_DIRECTORIES = ['.git', 'node_modules', 'vendor'];

    /**
     * @param array<string, mixed> $request
     * @return array<string, mixed>
     */
    public function build(array $request): array
    {
        $this->requireSchemaVersion($request);
        $target = $this->requireObject($request, 'targetSnapshot');
        $profile = $this->requireObject($request, 'analysisProfile');
        $sourceDirectory = $this->requireString($request, 'sourceDirectory');
        $root = realpath($sourceDirectory);
        if ($root === false || !is_dir($root)) {
            throw new \InvalidArgumentException('sourceDirectory is not a directory');
        }

        $targetId = $this->requireString($target, 'id');
        $targetDigest = $this->requireString($target, 'digest');
        $profileId = $this->requireString($profile, 'id');
        $phpVersion = $this->requireString($profile, 'phpVersion');
        $parser = (new ParserFactory())->createForVersion(PhpVersion::fromString($phpVersion));

        $files = [];
        $diagnostics = [];
        foreach ($this->phpFiles($root) as $relativePath => $absolutePath) {
            $code = file_get_contents($absolutePath);
            if ($code === false) {
                throw new \RuntimeException('Unable to read PHP source: ' . $relativePath);
            }

            $parseErrors = new Collecting();
            $ast = $parser->parse($code, $parseErrors) ?? [];
            $nameErrors = new Collecting();
            $visitor = new IndexVisitor();
            if ($ast !== []) {
                $traverser = new NodeTraverser(
                    new NameResolver($nameErrors, ['preserveOriginalNames' => true]),
                    $visitor,
                );
                $traverser->traverse($ast);
            }

            $fileDiagnostics = [
                ...$this->diagnostics($parseErrors->getErrors(), 'parse-error'),
                ...$this->diagnostics($nameErrors->getErrors(), 'name-resolution-error'),
            ];
            usort($fileDiagnostics, [$this, 'compareDiagnostics']);
            foreach ($fileDiagnostics as $diagnostic) {
                $diagnostics[] = ['path' => $relativePath, ...$diagnostic];
            }

            $files[] = [
                'path' => $relativePath,
                'digest' => 'sha256:' . hash('sha256', $code),
                'symbols' => $visitor->symbols(),
                'calls' => $visitor->calls(),
                'wordpressFacts' => $visitor->wordpressFacts(),
                'diagnostics' => $fileDiagnostics,
            ];
        }

        return [
            'schemaVersion' => 1,
            'generator' => [
                'name' => 'wordpress-harness/php-program-index',
                'version' => '0.1.0',
                'phpParserVersion' => ltrim(
                    InstalledVersions::getPrettyVersion('nikic/php-parser') ?? 'unknown',
                    'v',
                ),
            ],
            'targetSnapshot' => [
                'id' => $targetId,
                'digest' => $targetDigest,
            ],
            'analysisProfile' => [
                'id' => $profileId,
                'phpVersion' => $phpVersion,
            ],
            'files' => $files,
            'diagnostics' => $diagnostics,
        ];
    }

    /** @return array<string, string> */
    private function phpFiles(string $root): array
    {
        $directory = new RecursiveDirectoryIterator(
            $root,
            RecursiveDirectoryIterator::SKIP_DOTS,
        );
        $filter = new RecursiveCallbackFilterIterator(
            $directory,
            static function (SplFileInfo $current): bool {
                try {
                    if ($current->isLink()) {
                        return false;
                    }
                    if ($current->isDir()) {
                        return !in_array(
                            $current->getFilename(),
                            self::EXCLUDED_DIRECTORIES,
                            true,
                        );
                    }
                    return true;
                } catch (\RuntimeException) {
                    // open_basedir rejects links whose resolved target is outside the root.
                    return false;
                }
            },
        );
        $iterator = new RecursiveIteratorIterator($filter, RecursiveIteratorIterator::LEAVES_ONLY);
        $prefix = rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        $files = [];

        foreach ($iterator as $file) {
            if (!$file instanceof SplFileInfo) {
                continue;
            }
            try {
                if (!$file->isFile() || $file->isLink()) {
                    continue;
                }
            } catch (\RuntimeException) {
                continue;
            }
            if (strtolower($file->getExtension()) !== 'php') {
                continue;
            }
            $absolutePath = $file->getRealPath();
            if ($absolutePath === false || !str_starts_with($absolutePath, $prefix)) {
                continue;
            }
            $relativePath = str_replace(DIRECTORY_SEPARATOR, '/', substr($absolutePath, strlen($prefix)));
            $files[$relativePath] = $absolutePath;
        }

        ksort($files, SORT_STRING);
        return $files;
    }

    /**
     * @param list<Error> $errors
     * @return list<array<string, mixed>>
     */
    private function diagnostics(array $errors, string $kind): array
    {
        return array_map(static function (Error $error) use ($kind): array {
            $attributes = $error->getAttributes();
            return [
                'kind' => $kind,
                'message' => $error->getRawMessage(),
                'range' => [
                    'startLine' => max(1, $error->getStartLine()),
                    'endLine' => max(1, $error->getEndLine()),
                    'startOffset' => max(0, (int) ($attributes['startFilePos'] ?? 0)),
                    'endOffset' => max(0, (int) ($attributes['endFilePos'] ?? 0)),
                ],
            ];
        }, $errors);
    }

    /** @param array<string, mixed> $left @param array<string, mixed> $right */
    private function compareDiagnostics(array $left, array $right): int
    {
        return [$left['range']['startOffset'], $left['kind'], $left['message']]
            <=> [$right['range']['startOffset'], $right['kind'], $right['message']];
    }

    /** @param array<string, mixed> $request */
    private function requireSchemaVersion(array $request): void
    {
        if (($request['schemaVersion'] ?? null) !== 1) {
            throw new \InvalidArgumentException('Unsupported request schemaVersion');
        }
    }

    /**
     * @param array<string, mixed> $value
     * @return array<string, mixed>
     */
    private function requireObject(array $value, string $key): array
    {
        $object = $value[$key] ?? null;
        if (!is_array($object)) {
            throw new \InvalidArgumentException($key . ' must be an object');
        }
        return $object;
    }

    /** @param array<string, mixed> $value */
    private function requireString(array $value, string $key): string
    {
        $string = $value[$key] ?? null;
        if (!is_string($string) || $string === '') {
            throw new \InvalidArgumentException($key . ' must be a non-empty string');
        }
        return $string;
    }
}
