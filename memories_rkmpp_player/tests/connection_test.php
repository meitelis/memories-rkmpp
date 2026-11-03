<?php
declare(strict_types=1);

// Standalone contract tests: php memories_rkmpp_player/tests/connection_test.php
// The live Nextcloud middleware integration is checked separately on Nextcloud 35.
namespace OCP {
    interface IRequest
    {
        public function getRequestUri(): string;
    }

    class Server
    {
        public static IRequest $request;

        public static function get(string $id): IRequest
        {
            return self::$request;
        }
    }

    class Util
    {
        public static array $calls = [];

        public static function addScript(string $app, string $script): void
        {
            self::$calls[] = ['script', $app, $script];
        }

        public static function addStyle(string $app, string $style): void
        {
            self::$calls[] = ['style', $app, $style];
        }
    }
}

namespace OCP\AppFramework {
    class Http
    {
        public const STATUS_OK = 200;
        public const STATUS_BAD_REQUEST = 400;
    }

    abstract class Controller
    {
        public function __construct(protected string $appName, protected \OCP\IRequest $request) {}
    }
}

namespace OCP\AppFramework\Http {
    class DataDisplayResponse
    {
        public function __construct(private string $body, private int $status, private array $headers) {}
        public function render(): string { return $this->body; }
        public function getStatus(): int { return $this->status; }
        public function getHeaders(): array { return $this->headers; }
    }
}

namespace OCP\AppFramework\Http\Attribute {
    #[\Attribute(\Attribute::TARGET_METHOD)]
    class NoAdminRequired {}

    #[\Attribute(\Attribute::TARGET_METHOD)]
    class NoCSRFRequired {}

    #[\Attribute(\Attribute::TARGET_METHOD)]
    class UserRateLimit
    {
        public function __construct(public int $limit, public int $period) {}
    }
}

namespace OCP\EventDispatcher {
    class Event {}
    interface IEventListener { public function handle(Event $event): void; }
}

namespace OCP\AppFramework\Http\Events {
    class BeforeTemplateRenderedEvent extends \OCP\EventDispatcher\Event {}
}

namespace OCA\MemoriesRkmppPlayer\AppInfo {
    class Application { public const APP_ID = 'memories_rkmpp_player'; }
}

namespace OCA\MemoriesRkmppPlayer\Controller {
    // Count generation calls while exercising the real random byte generator.
    function random_bytes(int $length): string
    {
        $GLOBALS['connectionRandomCalls'][] = $length;
        return \random_bytes($length);
    }
}

namespace {
    use OCA\MemoriesRkmppPlayer\Controller\ConnectionController;
    use OCA\MemoriesRkmppPlayer\Listener\PlayerScriptListener;
    use OCP\AppFramework\Http\Attribute\NoAdminRequired;
    use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
    use OCP\AppFramework\Http\Attribute\UserRateLimit;
    use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
    use OCP\EventDispatcher\Event;
    use OCP\IRequest;
    use OCP\Server;
    use OCP\Util;

    require dirname(__DIR__) . '/lib/Controller/ConnectionController.php';
    require dirname(__DIR__) . '/lib/Listener/PlayerScriptListener.php';

    class Request implements IRequest
    {
        public function __construct(private string $uri) {}
        public function getRequestUri(): string { return $this->uri; }
    }

    function check(bool $condition, string $message): void
    {
        if (!$condition) {
            throw new \RuntimeException($message);
        }
    }

    function runTest(string $name, callable $test): void
    {
        $test();
        echo 'ok - ' . $name . PHP_EOL;
    }

    $GLOBALS['connectionRandomCalls'] = [];
    $controller = new ConnectionController(new Request('/apps/memories_rkmpp_player/connection-test'));

    runTest('default response is a fresh 128 KiB binary payload', static function () use ($controller): void {
        $first = $controller->test();
        $second = $controller->test();
        check($first->getStatus() === 200, 'Default request failed');
        check(strlen($first->render()) === 131072, 'Wrong default payload size');
        check($first->render() !== $second->render(), 'Payload was reused between requests');
    });

    runTest('bounds and decimal query strings return exactly the requested byte count', static function () use ($controller): void {
        foreach ([65536, '65536', 131072, '1048576', 1048576] as $size) {
            $response = $controller->test($size);
            check($response->getStatus() === 200, 'Valid size rejected');
            check(strlen($response->render()) === (int)$size, 'Response length differs from requested size');
            check($response->getHeaders()['Content-Length'] === (string)$size, 'Content-Length mismatch');
        }
        check(max($GLOBALS['connectionRandomCalls']) === 1048576, 'Payload generation exceeded the cap');
    });

    runTest('invalid sizes return HTTP 400 before any random bytes are generated', static function () use ($controller): void {
        $before = count($GLOBALS['connectionRandomCalls']);
        foreach ([null, [], ['1048576'], false, true, 65536.0, -1, 0, 65535, 1048577, PHP_INT_MAX, '', '1e6', '1048576x', str_repeat('9', 100000)] as $size) {
            check($controller->test($size)->getStatus() === 400, 'Invalid size accepted');
        }
        check(count($GLOBALS['connectionRandomCalls']) === $before, 'Invalid size reached payload generation');
    });

    runTest('response prevents caching, transformation, compression and MIME sniffing', static function () use ($controller): void {
        $headers = $controller->test()->getHeaders();
        check($headers['Content-Type'] === 'application/octet-stream', 'Payload is not binary');
        check($headers['Content-Encoding'] === 'identity', 'Payload allows content compression');
        check(str_contains($headers['Cache-Control'], 'no-store'), 'Payload can be stored');
        check(str_contains($headers['Cache-Control'], 'no-transform'), 'Payload allows proxy transformation');
        check($headers['Pragma'] === 'no-cache' && $headers['Expires'] === '0', 'Legacy cache prevention missing');
        check($headers['X-Content-Type-Options'] === 'nosniff', 'MIME sniffing was not disabled');
    });

    runTest('only the authenticated GET action is routed and it has a per-user rate limit', static function (): void {
        $routes = require dirname(__DIR__) . '/appinfo/routes.php';
        check($routes === ['routes' => [['name' => 'connection#test', 'url' => '/connection-test', 'verb' => 'GET']]], 'Unexpected routes');
        $method = new \ReflectionMethod(ConnectionController::class, 'test');
        $attributes = array_map(static fn(\ReflectionAttribute $attribute): string => $attribute->getName(), $method->getAttributes());
        check(in_array(NoAdminRequired::class, $attributes, true), 'Ordinary logged-in users are excluded');
        check(in_array(NoCSRFRequired::class, $attributes, true), 'Read-only GET unexpectedly requires CSRF');
        check(count($attributes) === 3 && !str_contains(implode(' ', $attributes), 'PublicPage'), 'Endpoint authentication was disabled');
        $rate = $method->getAttributes(UserRateLimit::class)[0]->newInstance();
        check($rate->limit === 6 && $rate->period === 60, 'Wrong per-user rate limit');
    });

    runTest('Memories templates load settings assets before the player', static function (): void {
        $listener = new PlayerScriptListener();
        foreach (['/apps/memories', '/index.php/apps/memories/?token=fixture', '/cloud/apps/memories/albums/1'] as $uri) {
            Server::$request = new Request($uri);
            Util::$calls = [];
            $listener->handle(new BeforeTemplateRenderedEvent());
            check(Util::$calls === [
                ['script', 'memories_rkmpp_player', 'settings'],
                ['style', 'memories_rkmpp_player', 'settings'],
                ['script', 'memories_rkmpp_player', 'player'],
            ], 'Settings assets were not loaded before player.js');
        }
        foreach (['/apps/files?next=/apps/memories', '/apps/memories_rkmpp_player/connection-test', '/apps/memories-other'] as $uri) {
            Server::$request = new Request($uri);
            Util::$calls = [];
            $listener->handle(new BeforeTemplateRenderedEvent());
            check(Util::$calls === [], 'Assets were loaded outside Memories');
        }
        Util::$calls = [];
        $listener->handle(new Event());
        check(Util::$calls === [], 'Non-template event loaded player assets');
    });
}
