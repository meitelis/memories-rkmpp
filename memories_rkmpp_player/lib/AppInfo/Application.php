<?php
declare(strict_types=1);
namespace OCA\MemoriesRkmppPlayer\AppInfo;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCA\MemoriesRkmppPlayer\Listener\PlayerScriptListener;
class Application extends App implements IBootstrap {
    public const APP_ID = 'memories_rkmpp_player';
    public function __construct(array $urlParams = []) { parent::__construct(self::APP_ID, $urlParams); }
    public function register(IRegistrationContext $context): void {
        $context->registerEventListener(BeforeTemplateRenderedEvent::class, PlayerScriptListener::class);
    }
    public function boot(IBootContext $context): void {}
}
