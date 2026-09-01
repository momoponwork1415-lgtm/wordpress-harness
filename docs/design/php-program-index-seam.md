# PHP Program Index seam

Status: confirmed internal seam; context-public test surface superseded by `source-mapping-seam.md`, 2026-09-01

PHP Source Analysisの内部interfaceは、固定Target SnapshotとAnalysis Profileからcontent-addressed `PHP Program Index`を作り、同じmoduleからruntime-validated indexを読む形である。実装は`source-mapping/php-program-index`に置き、Research contextの公開Interfaceからは公開しない。

```ts
interface PhpSourceAnalysis {
  analyze(input: AnalyzePhpSourceInput): Promise<PhpProgramIndexRef>;
  read(ref: PhpProgramIndexRef): Promise<PhpProgramIndex>;
}
```

## Input

- `targetSnapshot`: Researchが既にdigest固定したTarget Snapshot identity
- `sourceDirectory`: snapshot sourceのread-only local locator
- `profile`: versioned profile identityとtarget PHP version

`sourceDirectory`はartifact identityへ含めない。同じbytes、Target Snapshot、Analysis Profileはmachine上のpathに関係なく同じindex digestを作る。

## Output

schema version 1のindexは次だけを持つ。

- generatorとpinned PHP-Parser version
- Target SnapshotとAnalysis Profile identity
- relative pathとcontent digestでstable sortしたPHP file inventory
- source range付きsymbol declarationとcall relation
- WordPress registration、guard、source、storage、sinkのsyntactic fact
- fileごとのparse diagnostic

indexは脆弱性、taint、reachability、severityを判定しない。dynamic nameまたは解決不能なargumentは推測せず`null`またはdiagnosticとして記録する。

`guard`、`source`、`storage`、`sink`は候補経路を組み立てるための構文分類である。たとえば`echo`を`sink`として記録しても、値が未escapeであることやXSSが成立することは意味しない。値の関係、到達可能性、attacker premise、sanitization、実impactはMapper、Discovery、独立Verificationが証拠付きで判断する。

## Invariants

- helperはtarget fileを文字列として読み、PHP-Parserでparseするだけである。target file、autoload、Composer script、WordPress bootstrapを実行しない。
- target root外のsymlinkを追わず、`.git`と非source管理領域を除外する。現行schema v1は`vendor`と`node_modules`も一律除外するが、acceptedなSource Mappingではbundled vendor PHPをprovenance付きで扱うため、この除外はprofile-controlledな次versionへ移行する。
- stdin requestとstdout responseはversioned JSONとし、stderrをhandoffに使わない。
- TypeScript moduleはchild outputをruntime schemaで検証し、canonical JSONをprivate artifact directoryへatomic writeしてdigestを返す。
- child processへtimeout、output ceiling、PHP memory limitを適用する。failure時にpartial artifactを昇格しない。
- testはsynthetic PHP fixtureをpublic interfaceから解析し、PHP process内部またはraw ASTを観測しない。

## First behavior slices

1. synthetic pluginからsorted file inventory、function symbols、calls、hook/REST registrationsを抽出する
2. guard、request source、WordPress storage、security-relevant sinkをtyped syntactic factとして分類する
3. syntax errorを含むfileでもdiagnosticとrecoverable factsを返す
4. 同じinputを繰り返すと同じdigestとartifactを返す
5. target root外へのsymlinkとmalformed helper outputを安全側に拒否する

このinternal seamのtestは移行中の回帰保護として残せるが、根拠状態付きSurface Mapが実装された後は[Source mapping seam](source-mapping-seam.md)から同じobservable behaviorを確認し、helperの内部構造へ依存する重複testを残さない。
