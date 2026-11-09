<?php
declare(strict_types=1);

// Isolated integration test: exercise the real template listener without a
// running Nextcloud container. The stubs expose only the APIs it uses.
namespace OCP\EventDispatcher {
    class Event {}
    interface IEventListener {
        public function handle(Event $event): void;
    }
}
namespace OCP\AppFramework\Http\Events {
    class BeforeTemplateRenderedEvent extends \OCP\EventDispatcher\Event {}
}
namespace OCP {
    interface IConfig {}
    interface IRequest {}

    class Server {
        public static array $services = [];
        public static function get(string $id): object {
            return self::$services[$id];
        }
    }
    class Util {
        public static array $scripts = [];
        public static array $styles = [];
        public static function addScript(string $app, string $name): void {
            self::$scripts[] = "$app/$name";
        }
        public static function addStyle(string $app, string $name): void {
            self::$styles[] = "$app/$name";
        }
    }
}
namespace {
    require __DIR__ . '/../memories_rkmpp_v11/lib/Listener/PlayerScriptListener.php';

    use OCA\MemoriesRkmppV11\Listener\PlayerScriptListener;
    use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
    use OCP\EventDispatcher\Event;
    use OCP\IConfig;
    use OCP\IRequest;
    use OCP\Server;
    use OCP\Util;

    function verify(string $version, string $uri, bool $expected, bool $template = true): void {
        Server::$services[IConfig::class] = new class($version) implements IConfig {
            public function __construct(private string $version) {}
            public function getAppValue(string $app, string $key): string {
                if ($app !== 'memories' || $key !== 'installed_version') {
                    throw new \RuntimeException('Unexpected config lookup');
                }
                return $this->version;
            }
        };
        Server::$services[IRequest::class] = new class($uri) implements IRequest {
            public function __construct(private string $uri) {}
            public function getRequestUri(): string { return $this->uri; }
        };
        Util::$scripts = [];
        Util::$styles = [];

        (new PlayerScriptListener())->handle($template ? new BeforeTemplateRenderedEvent() : new Event());

        $scripts = [
            'memories_rkmpp_v11/policy',
            'memories_rkmpp_v11/player',
            'memories_rkmpp_v11/cadence',
        ];
        $styles = ['memories_rkmpp_v11/player'];
        $valid = $expected ? (Util::$scripts === $scripts && Util::$styles === $styles)
                           : (Util::$scripts === [] && Util::$styles === []);
        if (!$valid) {
            throw new \RuntimeException("Unexpected assets: version=$version uri=$uri template=".($template ? 'yes' : 'no').
                ' scripts='.json_encode(Util::$scripts).' styles='.json_encode(Util::$styles));
        }
    }

    foreach (['11.0.2', '11.1.1'] as $supported) {
        verify($supported, '/index.php/apps/memories/', true);
        verify($supported, '/apps/memories', true);
        verify($supported, '/index.php/apps/memories/viewer?foo=bar', true);
        verify($supported, '/index.php/apps/files/', false);
        verify($supported, '/index.php/apps/memories-extra/', false);
        verify($supported, '/index.php/apps/memories/', false, false);
    }
    foreach (['10.2.0', '11.0.1', '11.1.0', '11.2.0', '12.0.0'] as $unsupported) {
        verify($unsupported, '/index.php/apps/memories/', false);
    }
    echo "Memories adapter template listener: 17 cases passed\n";
}
