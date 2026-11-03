<?php
// Invoked only by the host updater as the Nextcloud web-server user.
declare(strict_types=1);

$app = 'memories_rkmpp_player';
[$script, $docroot, $mode] = $argv;
define('OC_CONSOLE', true);
require_once $docroot . '/lib/base.php';
$manager = \OCP\Server::get(\OCP\App\IAppManager::class);
$config = \OCP\Server::get(\OCP\IConfig::class);

if ($mode === 'inspect') {
    $requestedPath = $argv[3];
    $candidateVersion = $argv[4];
    $installed = $config->getAppValue($app, 'installed_version', '');
    $roots = $config->getSystemValue('apps_paths', [['path' => $docroot . '/apps', 'writable' => true]]);
    $writable = [];
    foreach ($roots as $root) {
        if (($root['writable'] ?? false) && is_dir($root['path']) && is_writable($root['path'])) {
            $writable[] = realpath($root['path']);
        }
    }
    try {
        $path = $manager->getAppPath($app, true);
    } catch (\OCP\App\AppPathNotFoundException $e) {
        if ($installed !== '') {
            throw new RuntimeException('Installed helper code is missing; restore it before updating.');
        }
        $path = $requestedPath !== '' ? $requestedPath : (($writable[0] ?? '') . '/' . $app);
    }
    if ($requestedPath !== '' && $requestedPath !== $path) {
        throw new RuntimeException('Requested app path differs from Nextcloud\'s registered helper path.');
    }
    $parent = realpath(dirname($path));
    if (basename($path) !== $app || !in_array($parent, $writable, true) || is_link($path)) {
        throw new RuntimeException('Helper must be a regular directory in a configured writable apps path.');
    }
    $path = $parent . '/' . $app;
    $exists = is_dir($path);
    if ($exists) {
        $xml = simplexml_load_string(file_get_contents($path . '/appinfo/info.xml'), SimpleXMLElement::class, LIBXML_NONET);
        if (!$xml || (string)$xml->id !== $app) {
            throw new RuntimeException('Existing directory is not the playback helper.');
        }
        if ($installed !== '' && (string)$xml->version !== $installed) {
            throw new RuntimeException('Complete the existing app upgrade before replacing its files.');
        }
    }
    if ($installed !== '' && version_compare($candidateVersion, $installed, '<')) {
        throw new RuntimeException('Refusing to downgrade the installed helper.');
    }
    echo $path, "\n", $installed, "\n", $exists ? '1' : '0', "\n";
} elseif ($mode === 'validate') {
    $stage = $argv[3];
    $expectedVersion = $argv[4];
    $xml = simplexml_load_string(file_get_contents($stage . '/appinfo/info.xml'), SimpleXMLElement::class, LIBXML_NONET);
    if (!$xml || (string)$xml->id !== $app || (string)$xml->version !== $expectedVersion) {
        throw new RuntimeException('Bundled helper identity/version did not validate.');
    }
    $info = $manager->getAppInfoByPath($stage . '/appinfo/info.xml');
    if (!$info || !$manager->isAppCompatible(implode('.', \OCP\Util::getVersion()), $info)) {
        throw new RuntimeException('Bundled helper is incompatible with this Nextcloud version.');
    }
} elseif ($mode === 'activate') {
    $expectedVersion = $argv[3];
    if ($config->getAppValue($app, 'installed_version', '') === '') {
        $manager->enableApp($app);
    } else {
        $manager->upgradeApp($app);
    }
    $actual = $config->getAppValue($app, 'installed_version', '');
    if ($actual !== $expectedVersion || $manager->getAppVersion($app, false) !== $expectedVersion) {
        throw new RuntimeException('App activation did not register the expected helper version.');
    }
    echo 'Playback helper ', $actual, $manager->isEnabledForAnyone($app) ? ' enabled' : ' (existing disabled state retained)', "\n";
} else {
    throw new InvalidArgumentException('Unknown updater operation.');
}
