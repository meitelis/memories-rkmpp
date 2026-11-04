<?php
declare(strict_types=1);
namespace OCA\MemoriesRkmppV11\AppInfo;
use OCA\MemoriesRkmppV11\Listener\PlayerScriptListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
class Application extends App implements IBootstrap {
    public function __construct(array $urlParams = []) { parent::__construct('memories_rkmpp_v11', $urlParams); }
    public function register(IRegistrationContext $context): void {
        $context->registerEventListener(BeforeTemplateRenderedEvent::class, PlayerScriptListener::class);
    }
    public function boot(IBootContext $context): void {}
}
