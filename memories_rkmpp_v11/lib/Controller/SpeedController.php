<?php
declare(strict_types=1);
namespace OCA\MemoriesRkmppV11\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\IRequest;

class SpeedController extends Controller {
    public function __construct(string $appName, IRequest $request) {
        parent::__construct($appName, $request);
    }

    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function probe(int $bytes = 393216): DataDisplayResponse {
        $bytes = max(32768, min(1572864, $bytes));
        return new DataDisplayResponse(random_bytes($bytes), 200, [
            'Content-Type' => 'application/octet-stream',
            'Content-Length' => (string)$bytes,
            'Content-Encoding' => 'identity',
            'Cache-Control' => 'private, no-store, no-transform',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
