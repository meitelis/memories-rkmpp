<?php
declare(strict_types=1);

namespace OCA\MemoriesRkmppV11\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Authenticated, CSRF-protected, failure-only mobile browser trace transport.
 *
 * No media URL, filename, source identifier, cookie or original payload is
 * accepted. Events and fields are allowlisted and capped before logging.
 */
class TraceController extends Controller {
    public function __construct(
        string $appName,
        IRequest $request,
        private LoggerInterface $logger,
    ) {
        parent::__construct($appName, $request);
    }

    #[NoAdminRequired]
    public function report(array $events = [], string $reason = 'waiting', string $session = ''): DataResponse {
        $allowedReasons = ['waiting', 'stall-recovered', 'fatal-error'];
        if (!in_array($reason, $allowedReasons, true)) {
            return new DataResponse(['ok' => false, 'error' => 'invalid reason'], 400);
        }

        $allowedEvents = [
            'playing', 'waiting', 'quality-decision', 'quality-scheduled',
            'level-presented', 'fragment-loading', 'fragment-buffered',
            'buffer-sample', 'hls-error', 'seeked', 'seeking', 'decoder-cap',
        ];
        $numeric = [
            'buffer', 'level', 'sn', 'bytes', 'totalMs', 'transferMs',
            'target', 'requestAge', 'playing', 'seconds', 'ms',
        ];
        $texts = ['reason', 'detail', 'phase'];
        $clean = [];

        // Last 60 records only, each containing a small fixed schema.
        foreach (array_slice($events, -60) as $row) {
            if (!is_array($row)) {
                continue;
            }
            $event = $row['event'] ?? null;
            if (!is_string($event) || !in_array($event, $allowedEvents, true)) {
                continue;
            }
            $item = ['event' => $event];
            if (isset($row['at']) && is_numeric($row['at'])) {
                $item['at'] = (int) $row['at'];
            }
            foreach ($numeric as $key) {
                if (isset($row[$key]) && is_numeric($row[$key])) {
                    $item[$key] = round((float) $row[$key], 2);
                }
            }
            foreach ($texts as $key) {
                if (isset($row[$key]) && is_string($row[$key])) {
                    $item[$key] = substr($row[$key], 0, 64);
                }
            }
            $clean[] = $item;
        }

        $session = preg_match('/^[a-z0-9-]{1,20}$/i', $session) ? $session : 'unknown';
        if ($clean === []) {
            return new DataResponse(['ok' => false, 'error' => 'no valid events'], 400);
        }
        $json = json_encode(
            ['session' => $session, 'reason' => $reason, 'events' => $clean],
            JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_SLASHES
        );
        // Nextcloud's normal log storage is accessible from the Radxa over SSH.
        $this->logger->warning('RKMMPP_MOBILE_TRACE ' . $json, ['app' => 'memories_rkmpp_v11']);

        return new DataResponse(['ok' => true, 'events' => count($clean)]);
    }
}
