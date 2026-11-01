<?php
/** Thin PDO wrapper that works on MySQL/MariaDB and SQLite with the same SQL. */
class DB
{
    public PDO $pdo;
    public string $driver;   // mysql | sqlite
    public string $p;        // table prefix

    public function __construct(PDO $pdo, string $prefix = 'ft_')
    {
        $this->pdo = $pdo;
        $this->p = preg_replace('/[^A-Za-z0-9_]/', '', $prefix);
        $this->driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'sqlite' : 'mysql';
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        if ($this->driver === 'sqlite') {
            $pdo->exec('PRAGMA foreign_keys = OFF');
            $pdo->exec('PRAGMA journal_mode = WAL');
        } else {
            $pdo->exec("SET NAMES utf8mb4");
            // real prepares → numbers come back as int (on PHP < 8.1 the default would be strings)
            $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
            $pdo->setAttribute(PDO::ATTR_STRINGIFY_FETCHES, false);
        }
    }

    public static function fromConfig(array $c): DB
    {
        if ($c['driver'] === 'pdo') return new DB($c['pdo'], $c['prefix']);
        if ($c['driver'] === 'sqlite') {
            $dir = dirname($c['path']);
            if ($c['path'] !== ':memory:' && !is_dir($dir)) @mkdir($dir, 0775, true);
            return new DB(new PDO('sqlite:' . $c['path']), $c['prefix']);
        }
        $dsn = 'mysql:host=' . $c['host'] . ($c['port'] ? ';port=' . $c['port'] : '') . ';dbname=' . $c['name'] . ';charset=utf8mb4';
        return new DB(new PDO($dsn, $c['user'], $c['pass'], [PDO::ATTR_TIMEOUT => 5]), $c['prefix']);
    }

    /** Replace {table} placeholders with prefixed names. */
    public function sql(string $sql): string
    {
        return preg_replace_callback('/\{(\w+)\}/', fn($m) => $this->p . $m[1], $sql);
    }

    public function q(string $sql, array $args = []): PDOStatement
    {
        $st = $this->pdo->prepare($this->sql($sql));
        foreach (array_values($args) === $args ? $args : [] as $i => $v) {
            $st->bindValue($i + 1, $v, is_int($v) ? PDO::PARAM_INT : (is_null($v) ? PDO::PARAM_NULL : PDO::PARAM_STR));
        }
        if (array_values($args) !== $args) {
            foreach ($args as $k => $v) $st->bindValue(':' . ltrim($k, ':'), $v, is_int($v) ? PDO::PARAM_INT : (is_null($v) ? PDO::PARAM_NULL : PDO::PARAM_STR));
        }
        $st->execute();
        return $st;
    }

    public function all(string $sql, array $a = []): array { return $this->q($sql, $a)->fetchAll(); }
    public function row(string $sql, array $a = []): ?array { $r = $this->q($sql, $a)->fetch(); return $r ?: null; }
    public function val(string $sql, array $a = []) { $r = $this->q($sql, $a)->fetchColumn(); return $r === false ? null : $r; }
    public function col(string $sql, array $a = []): array { return $this->q($sql, $a)->fetchAll(PDO::FETCH_COLUMN); }

    public function insert(string $table, array $data): int
    {
        $cols = array_keys($data);
        $sql = 'INSERT INTO {' . $table . '} (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')';
        $this->q($sql, array_values($data));
        return (int)$this->pdo->lastInsertId();
    }

    public function update(string $table, array $data, int $id): void
    {
        if (!$data) return;
        $set = implode(',', array_map(fn($c) => "$c = ?", array_keys($data)));
        $this->q('UPDATE {' . $table . '} SET ' . $set . ' WHERE id = ?', array_merge(array_values($data), [$id]));
    }

    public function delete(string $table, int $id): void
    {
        $this->q('DELETE FROM {' . $table . '} WHERE id = ?', [$id]);
    }

    public function inTx(callable $fn)
    {
        if ($this->pdo->inTransaction()) return $fn();
        $this->pdo->beginTransaction();
        try { $r = $fn(); $this->pdo->commit(); return $r; }
        catch (Throwable $e) { $this->pdo->rollBack(); throw $e; }
    }

    public function tableExists(string $t): bool
    {
        $name = $this->p . $t;
        if ($this->driver === 'sqlite') return (bool)$this->val("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [$name]);
        return (bool)$this->pdo->query("SHOW TABLES LIKE " . $this->pdo->quote(addcslashes($name, '_%')))->fetchColumn();
    }

    public function columns(string $t): array
    {
        $name = $this->p . $t;
        if ($this->driver === 'sqlite') return array_column($this->pdo->query("PRAGMA table_info($name)")->fetchAll(), 'name');
        return array_column($this->pdo->query("SHOW COLUMNS FROM `$name`")->fetchAll(), 'Field');
    }

    private function colType(string $type): string
    {
        $my = $this->driver === 'mysql';
        if ($type === 'id') return $my ? 'INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        if ($type === 'int') return $my ? 'INT NULL' : 'INTEGER NULL';
        if ($type === 'bool') return $my ? 'TINYINT NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0';
        if ($type === 'float') return $my ? 'DOUBLE NULL' : 'REAL NULL';
        if ($type === 'text') return $my ? 'MEDIUMTEXT NULL' : 'TEXT NULL';
        if ($type === 'datetime') return $my ? 'VARCHAR(19) NULL' : 'TEXT NULL';
        if (preg_match('/^str(\d+)$/', $type, $m)) return $my ? "VARCHAR({$m[1]}) NULL" : 'TEXT NULL';
        throw new RuntimeException("unknown column type $type");
    }

    /** Non-fatal problems of the last migrate() run (e.g. an index the DB user may not create). */
    public array $warnings = [];

    private function indexNames(string $name): array
    {
        if ($this->driver === 'sqlite') return array_column($this->pdo->query("PRAGMA index_list($name)")->fetchAll(), 'name');
        return array_unique(array_column($this->pdo->query("SHOW INDEX FROM `$name`")->fetchAll(), 'Key_name'));
    }

    /**
     * Create missing tables / columns / indexes. Idempotent and safe if two requests run it at once.
     * On MySQL the indexes are part of CREATE TABLE (needs only the CREATE privilege, one statement per table);
     * a missing index on an existing table is added best-effort and never blocks the app.
     */
    public function migrate(array $schema): array
    {
        $log = [];
        $this->warnings = [];
        $my = $this->driver === 'mysql';
        $q = fn($c) => $my ? "`$c`" : $c;
        foreach ($schema as $t => $def) {
            $name = $this->p . $t;
            $idx = $def['idx'] ?? [];
            if (!$this->tableExists($t)) {
                $cols = [];
                foreach ($def['cols'] as $c => $type) $cols[] = $q($c) . ' ' . $this->colType($type);
                if ($my) foreach ($idx as $i => $icols) $cols[] = (str_starts_with($i, 'u_') ? 'UNIQUE KEY ' : 'KEY ') . "`{$name}_$i` (" . implode(',', array_map($q, $icols)) . ')';
                $sql = "CREATE TABLE IF NOT EXISTS " . $q($name) . " (" . implode(', ', $cols) . ")";
                if ($my) $sql .= ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
                $this->pdo->exec($sql);
                $log[] = "CREATE $name";
            } else {
                $have = $this->columns($t);
                foreach ($def['cols'] as $c => $type) {
                    if (!in_array($c, $have, true)) {
                        $this->pdo->exec("ALTER TABLE " . $q($name) . " ADD COLUMN " . $q($c) . ' ' . $this->colType($type));
                        $log[] = "ALTER $name ADD $c";
                    }
                }
            }
            if (!$idx) continue;
            $haveIdx = $this->indexNames($name);
            foreach ($idx as $i => $icols) {
                $iname = "{$name}_$i";
                if (in_array($iname, $haveIdx, true)) continue;
                $uniq = str_starts_with($i, 'u_') ? 'UNIQUE ' : '';
                try {
                    $this->pdo->exec("CREATE {$uniq}INDEX " . $q($iname) . " ON " . $q($name) . " (" . implode(',', array_map($q, $icols)) . ")");
                } catch (Throwable $e) {
                    $this->warnings[] = "$iname: " . $e->getMessage();
                }
            }
        }
        return $log;
    }
}
