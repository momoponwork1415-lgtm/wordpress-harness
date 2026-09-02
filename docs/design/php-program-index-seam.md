# PHP Program Index seam

Status: confirmed internal seam; generator 0.2.0 implemented, 2026-09-02

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

generator 0.2.0が局所的に分類するsecurity factは次である。

- request source: `WP_REST_Request::get_param`と`$_GET`、`$_POST`、`$_REQUEST`、`$_COOKIE`、`$_FILES`の各参照。添字アクセスだけでなくスーパーグローバル全体を別functionへ渡す参照も含む
- database query sink: receiverが明示的な`$wpdb`である`query`、`get_var`、`get_row`、`get_col`、`get_results`
- filesystem write sink: `file_put_contents`
- code execution sink: `eval`と`include`、`include_once`、`require`、`require_once`
- process execution sink: `exec`、`system`、`passthru`、`shell_exec`、`popen`、`proc_open`、`pcntl_exec`
- HTML output sink、authorization guard、option read/write: 既存の`echo`、`current_user_can`、`get_option`、`update_option`

`guard`、`source`、`storage`、`sink`は候補経路を組み立てるための構文分類である。たとえば`$wpdb->query`を記録してもSQLがattacker-controlledであるとは限らず、`require_once`には固定bootstrap pathも含まれる。`echo`を記録しても値が未escapeであることやXSSが成立することは意味しない。値の関係、到達可能性、attacker premise、sanitization、実impactはMapper、Discovery、独立Verificationが証拠付きで判断する。

新しいfact規則を追加したためgenerator versionを0.2.0へ上げた。readerは既存CASの0.1.0を引き続き受理するが、新規解析は0.2.0を生成し、規則変更前後を同じgenerator identityへ潰さない。

## Invariants

- helperはtarget fileを文字列として読み、PHP-Parserでparseするだけである。target file、autoload、Composer script、WordPress bootstrapを実行しない。
- target root外のsymlinkを追わず、`.git`と非source管理領域を除外する。現行schema v1は`vendor`と`node_modules`も一律除外するが、acceptedなSource Mappingではbundled vendor PHPをprovenance付きで扱うため、この除外はprofile-controlledな次versionへ移行する。
- stdin requestとstdout responseはversioned JSONとし、stderrをhandoffに使わない。
- TypeScript moduleはchild outputをruntime schemaで検証し、canonical JSONをprivate artifact directoryへatomic writeしてdigestを返す。
- child processへtimeout、output ceiling、PHP memory limitを適用する。failure時にpartial artifactを昇格しない。
- testはsynthetic PHP fixtureをpublic interfaceから解析し、PHP process内部またはraw ASTを観測しない。

## First behavior slices

1. synthetic pluginからsorted file inventory、function symbols、calls、hook/REST registrationsを抽出する
2. guard、REST/superglobal request source、WordPress storage、SQL/file/code/process/output sinkをtyped syntactic factとして分類する
3. syntax errorを含むfileでもdiagnosticとrecoverable factsを返す
4. 同じinputを繰り返すと同じdigestとartifactを返す
5. target root外へのsymlinkとmalformed helper outputを安全側に拒否する

このinternal seamのtestはPHP抽出behaviorを保護する。[Source mapping seam](source-mapping-seam.md)のtestは固定PHP Program Indexをmapへ取り込み、根拠状態、inventory、gap、revisionを観測する。両方で同じ内部visitorまたは変換helperを重複検査しない。
