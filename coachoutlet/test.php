<?php
function callURL($url, &$data)
{
    $data = file_get_contents($url);
}

function saveData(&$bigJson, $db)
{
    $data = json_decode($bigJson, true);
    unset($bigJson); // Asli string ko turant RAM se hataya

    foreach ($data as &$row) { // '&' lagane se array copy nahi hoga
        $db->insert('table', $row);
    }
    unset($row); // Reference ko break karna zaroori hai loop ke baad
}

// EXECUTION
$url = "https://api.example.com/big-data";
$myData = null;

// Yahan $myData pass karna zaroori hai tabhi reference kaam karega
callURL($url, $myData);

if ($myData) {
    saveData($myData, $db);
}
