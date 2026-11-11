<?php
declare(strict_types=1);
namespace OCA\MemoriesRkmppV11\Listener;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IConfig;
use OCP\IRequest;
use OCP\Server;
use OCP\Util;
class PlayerScriptListener implements IEventListener {
    public function handle(Event $event): void {
        if (!$event instanceof BeforeTemplateRenderedEvent) { return; }
        // Only inject on verified upstream player interfaces. Do not assume future
        // Memories releases retain the same hls.js quality-controller hooks.
        $version = Server::get(IConfig::class)->getAppValue('memories', 'installed_version');
        if (!in_array($version, ['11.0.2', '11.1.1', '11.1.2'], true)) { return; }
        $path = parse_url(Server::get(IRequest::class)->getRequestUri(), PHP_URL_PATH);
        if (is_string($path) && preg_match('~/apps/memories(?:/|$)~', $path)) {
            Util::addScript('memories_rkmpp_v11', 'policy');
            Util::addScript('memories_rkmpp_v11', 'player');
            Util::addScript('memories_rkmpp_v11', 'cadence');
            Util::addStyle('memories_rkmpp_v11', 'player');
        }
    }
}
