<?php

// Include the authparse.php file
include 'authparse.php';

function authTail($searchDict, $page, $linesPerPage)
{
    // Path to the auth log file
    $logFilePaths = getAuthLogFiles();

    // get search parameters
    $search = $searchDict['search'];
    $ip = $searchDict['ip'];
    $date = $searchDict['date'];
    $stat = $searchDict['stat'];

    // generate UNIX grep command line argument to only include lines containing IP addresses
    $grepIPCmd = "grep -E '([0-9]{1,3}\.){3}[0-9]{1,3}'";

    // generate UNIX grep command line arguments to include services we care about
    $services = ['sshd', 'sudo'];
    $grepArgs = '';
    foreach ($services as $service) {
        $grepArgs .= " -e $service";
    }
    $grepSrvCmd = "grep $grepArgs";

    // generate cat command to concatenate all log files
    $catCmd = 'cat ' . implode(' ', $logFilePaths);

    // build UNIX command
    if ($searchDict) {
        $cmd = "$catCmd | $grepSrvCmd | $grepIPCmd | tac ";
    } else {
        // compute the first and last line numbers
        $firstLine = $page * $linesPerPage + 1;
        $lastLine = $firstLine + ($linesPerPage - 1);
        $cmd = "$catCmd | $grepSrvCmd | $grepIPCmd | tail -n $lastLine | head -n $linesPerPage | tac";
    }

    // execute the UNIX command
    $fp = popen($cmd, 'r');

    // read the lines from UNIX pipe
    $lines = [];
    while ($line = fgets($fp)) {
        $lines[] = $line;
    }

    pclose($fp);

    // Read in CLF header name array from clfhead.json
    $headers = json_decode(file_get_contents('loghead.json'));

    // Create array of auth log lines
    $logLines = [];
    $logLines[] = $headers;

    // Process each line and add to the array
    $lineCount = 0;
    foreach ($lines as $line) {
        $data = parseAuthLogLine($line);

        if ($data === false) {
            $logLines[] = ['-', '-', $line, 'ERROR'];
            continue;
        }

        // If $search is set, check if $data[2] contains $search
        if ($search) {
            if (strpos($data[2], $search) === false) {
                continue;
            }
        }

        // If $ip is set, check if $data[0] contains $ip
        if ($ip) {
            if (strpos($data[0], $ip) === false) {
                continue;
            }
        }

        // If $date is set, check if $data[1] contains $date
        if ($date) {
            if (strpos($data[1], $date) === false) {
                continue;
            }
        }

        // determine status based on $data[2]
        $status = getAuthLogStatus($data[2]);

        // If $stat is set, check if $status matches $stat
        if ($stat) {
            if ($status !== $stat) {
                continue;
            }
        }

        $logLines[] = [$data[0], $data[1], $data[2], $status];
        $lineCount++;
        if ($lineCount >= $linesPerPage) {
            break;
        }
    }

    // Output the array as JSON
    echo json_encode($logLines);
}
