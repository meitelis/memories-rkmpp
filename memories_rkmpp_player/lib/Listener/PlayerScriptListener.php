<?php
declare(strict_types=1);

namespace OCA\MemoriesRkmppPlayer\Listener;

use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IRequest;
use OCP\Server;
use OCP\Util;

class PlayerScriptListener implements IEventListener
{
    public function handle(Event $event): void
    {
        if (!$event instanceof BeforeTemplateRenderedEvent) {
            return;
        }

        $path = parse_url(Server::get(IRequest::class)->getRequestUri(), PHP_URL_PATH);
        if (is_string($path) && preg_match('~/apps/memories(?:/|$)~', $path)) {
            Util::addScript('memories_rkmpp_player', 'player');
        }
    }
}
