<?php
define('API_KEY', 'a089a1e20a5c377aea41f6a713782a43');
?>
<?php

$TARGET_URL = "https://www.coachoutlet.com/products/turner-flap-crossbody-bag/CCQ52.html?frp=CCQ52+QBOLV";
$API_KEY = "a089a1e20a5c377aea41f6a713782a43"; // paste your key

$tests = [
    [
        "name" => "premium_render",
        "params" => [
            "api_key" => $API_KEY,
            "url" => $TARGET_URL,
            "premium" => "true",
            "render" => "true",
            "country_code" => "us",
        ],
        "file" => "debug_premium_render.html",
    ],
    [
        "name" => "ultra_render",
        "params" => [
            "api_key" => $API_KEY,
            "url" => $TARGET_URL,
            "ultra_premium" => "true",
            "render" => "true",
            "country_code" => "us",
        ],
        "file" => "debug_ultra_render.html",
    ],
    [
        "name" => "ultra_norender",
        "params" => [
            "api_key" => $API_KEY,
            "url" => $TARGET_URL,
            "ultra_premium" => "true",
            "render" => "false",
            "country_code" => "us",
        ],
        "file" => "debug_ultra_norender.html",
    ],
];

function fetch_and_save($apiUrl, $file)
{
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 180);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);
    curl_setopt($ch, CURLOPT_ENCODING, "");

    $response = curl_exec($ch);
    if ($response === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new Exception("cURL Error: " . $err);
    }

    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    file_put_contents($file, $response);

    $len = strlen($response);
    $hasTitle = (strpos($response, "pdp_txt_pdt_title") !== false);
    $hasCart  = (strpos($response, "add-to-cart") !== false);

    return [$httpCode, $len, $hasTitle, $hasCart];
}

foreach ($tests as $t) {


    $apiUrl = "https://api.scraperapi.com/?" . http_build_query($t["params"]);

    echo "\n=== TEST: {$t['name']} ===\n";
    echo "Saving to: {$t['file']}\n";

    try {
        [$code, $len, $hasTitle, $hasCart] = fetch_and_save($apiUrl, $t["file"]);
        echo "HTTP Status: {$code}\n";
        echo "Length     : {$len} bytes\n";
        echo "Markers    : title=" . ($hasTitle ? "true" : "false") . " cart=" . ($hasCart ? "true" : "false") . "\n";
    } catch (Exception $e) {
        echo "ERROR: " . $e->getMessage() . "\n";
    }
}
