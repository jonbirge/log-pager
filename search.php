<?php

// Parameters
$maxResults = 1024;
$logFile = "/access.log";

// Get search term from URL
$searchTerm = $_GET['term'];

// Build UNIX command
$command = "grep $searchTerm $logFile | tail -n $maxResults";

// Run command and store results in array
exec($command, $results);

// Make array of CLF log headers: IP Address, Timestamp, Request, Status, Size
$headers = ['IP Address', 'Timestamp', 'Request', 'Status', 'Size'];

// Create array of CLF log lines
$logLines = [];
$logLines[] = $headers;

// Process each line and add to the array
foreach ($results as $line) {
    preg_match('/(\S+) \S+ \S+ \[(.+?)\] \"(.*?)\" (\S+) (\S+)/', $line, $matches);
    // Go through each match and add to the array with htmlspecialchars()
    $logLines[] = array_map('htmlspecialchars', array_slice($matches, 1));
}

// Return JSON encoded array
echo json_encode($logLines);

?>
