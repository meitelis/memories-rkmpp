<?php
declare(strict_types=1);

namespace OCA\MemoriesRkmppPlayer\Controller;

use OCA\MemoriesRkmppPlayer\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\IRequest;

class ConnectionController extends Controller
{
    private const DEFAULT_BYTES = 131072;
    private const MIN_BYTES = 65536;
    private const MAX_BYTES = 1048576;

    public function __construct(IRequest $request)
    {
        parent::__construct(Application::APP_ID, $request);
    }

    #[NoAdminRequired]
    #[NoCSRFRequired]
    #[UserRateLimit(limit: 6, period: 60)]
    public function test(mixed $bytes = self::DEFAULT_BYTES): DataDisplayResponse
    {
        // Keep malformed/oversized values out of integer conversion and the RNG.
        if (!is_int($bytes) && (!is_string($bytes) || preg_match('/\A[0-9]{1,7}\z/', $bytes) !== 1)) {
            return $this->response('Invalid connection-test size.', Http::STATUS_BAD_REQUEST);
        }
        $size = (int)$bytes;
        if ($size < self::MIN_BYTES || $size > self::MAX_BYTES) {
            return $this->response('Connection-test size must be between 65536 and 1048576 bytes.', Http::STATUS_BAD_REQUEST);
        }

        // One bounded binary allocation; no encoding or duplicate payload buffer.
        return $this->response(random_bytes($size));
    }

    private function response(string $body, int $status = Http::STATUS_OK): DataDisplayResponse
    {
        return new DataDisplayResponse($body, $status, [
            'Content-Type' => 'application/octet-stream',
            'Content-Encoding' => 'identity',
            'Content-Length' => (string)strlen($body),
            'Cache-Control' => 'no-store, no-cache, must-revalidate, no-transform',
            'Pragma' => 'no-cache',
            'Expires' => '0',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
