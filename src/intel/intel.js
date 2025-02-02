// global params
const params = new URLSearchParams(window.location.search);
const targetIP = params.get("ip");

function runScan(mode) {
    const uniqueID = Math.random().toString(36).substr(2, 9);
    const scanDiv = document.getElementById('scan');
    const scanButtonDiv = document.getElementById('scan-buttons');
    let initialButtons = scanButtonDiv.innerHTML;
    let scanPollInterval;
    let waitCount = 0;

    let scanURL;
    if (mode === 'deep') {
        scanURL = 'intel/startscan.php?ip=' + targetIP + '&id=' + uniqueID + '&mode=deep';
    } else {
        scanURL = 'intel/startscan.php?ip=' + targetIP + '&id=' + uniqueID + '&mode=quick';
    }
    console.log("runScan: " + scanURL);
    scanButtonDiv.innerHTML = "<p><b>Starting port scan...</b></p>";
    fetch(scanURL)
    .then(response => {
        if (response.ok) {
            scanPollInterval = setInterval(pollScanServer, 1000);
        } else {
            scanDiv.innerHTML = '<p>Error starting port scan script</p>';
        }
    });

    function pollScanServer() {
        // write message to scanButtonDiv each time we poll
        waitCount++;
        scanButtonDiv.innerHTML = "<p><b>Running port scan" + ".".repeat(waitCount % 4) + "</b></p>";

        fetch('intel/pollscan.php?id=' + uniqueID)
            .then(response => response.text())
            .then(data => {
                // Parsing JSON data
                var scanData = JSON.parse(data);
                var scanDone = false;

                // Check to see if the last element is the EOF token, and if it is, remove it
                if (scanData[scanData.length - 1] === "EOF") {
                    scanData.pop();
                    scanDone = true;
                    console.log("EOF encountered. Scan done.");
                }

                // Put the data into a <pre> tag inside the scanDiv
                scanDiv.innerHTML = "<pre>" + scanData.join("") + "</pre>";

                if (scanDone) {
                    clearInterval(scanPollInterval);
                    fetch('intel/cleanscan.php?id=' + uniqueID);
                    scanButtonDiv.innerHTML = initialButtons;
                }
            });
    }
}

function runPing() {
    const uniqueID = Math.random().toString(36).substr(2, 9);
    const pingDiv = document.getElementById('ping-button');
    const pingCanvas = document.getElementById('ping-chart');
    let pingPollInterval;

    // Add canvas to page
    pingCanvas.innerHTML = '<canvas id="pingChart" style="width: 80%"></canvas>';
    var ctx = document.getElementById('pingChart').getContext('2d');
    var pingChart = new Chart(ctx, {
        type: 'bar', // Using bar chart to represent histogram
        data: {
            labels: [], // Empty labels
            datasets: [{
                label: 'Ping Time Frequency',
                data: [], // Empty data
                backgroundColor: 'rgba(0, 123, 255, 0.5)',
                borderColor: 'rgba(0, 123, 255, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    function pollPingServer() {
        fetch('intel/pollping.php?id=' + uniqueID)
            .then(response => response.text())
            .then(data => {
                // Parsing JSON data
                var pingData = JSON.parse(data);
                var pingDone = false;

                // Check to see if the last element is -1, and if it is, remove it
                if (pingData[pingData.length - 1] === -1) {
                    pingData.pop();
                    pingDone = true;
                    console.log("Ping done!");
                }

                // Calculate min and max ping values
                const minPing = Math.min(...pingData);
                const maxPing = Math.max(...pingData);
                const binCount = 15;
                const binSize = (maxPing - minPing) / binCount;

                // Create bins for histogram
                const histogram = new Array(binCount).fill(0);

                pingData.forEach(ping => {
                    const binIndex = Math.floor((ping - minPing) / binSize);
                    histogram[Math.min(binIndex, binCount - 1)]++;
                });

                // Preparing labels for each bin
                const labels = histogram.map((_, index) => {
                    const start = (minPing + index * binSize).toFixed(2);
                    const end = (minPing + (index + 1) * binSize).toFixed(2);
                    return `${start}-${end} ms`;
                });

                // Updating chart with new data
                pingChart.data.labels = labels;
                pingChart.data.datasets[0].data = histogram;
                pingChart.update();

                if (pingDone) {
                    clearInterval(pingPollInterval);
                    fetch('intel/cleanping.php?id=' + uniqueID);
                    pingDiv.innerHTML = "<p><button class='toggle-button' onclick='runPing()'>Run ping again</button></p>";
                }
            });
    }

    fetch('intel/startping.php?ip=' + targetIP + '&id=' + uniqueID)
        .then(response => {
            pingDiv.innerHTML = "<p>Running ping...</p>";
            if (response.ok) {
                pingPollInterval = setInterval(pollPingServer, 1000);
            } else {
                pingDiv.innerHTML = '<p>Error starting ping script</p>';
            }
        });
}

function runTrace() {
    const uniqueID = Math.random().toString(36).substr(2, 9);
    const traceDiv = document.getElementById('trace');
    const traceButtonDiv = document.getElementById('trace-button');
    let tracePollInterval;
    let waitCount = 0;

    function pollTraceServer() {
        // write message to traceButtonDiv each time we poll
        waitCount++;
        traceButtonDiv.innerHTML = "Running traceroute" + ".".repeat(waitCount % 4);

        fetch('intel/polltrace.php?id=' + uniqueID)
            .then(response => response.text())
            .then(data => {
                if (data.indexOf("END_OF_FILE") !== -1) {
                    clearInterval(tracePollInterval);
                    traceDiv.innerHTML = data;
                    traceButtonDiv.innerHTML = "<button class='toggle-button' onclick='runTrace()'>Run trace again</button>";
                    fetch('intel/cleantrace.php?id=' + uniqueID);
                } else {
                    traceDiv.innerHTML = data;
                }
            });
    }

    const traceURL = 'intel/starttrace.php?ip=' + targetIP + '&id=' + uniqueID;
    console.log(traceURL);
    fetch(traceURL)
        .then(response => {
            traceButtonDiv.innerHTML = "Running traceroute...";
            if (response.ok) {
                tracePollInterval = setInterval(pollTraceServer, 1000);
            } else {
                traceDiv.innerHTML = '<p>Error starting traceroute!</p>';
            }
        });
}

function runWhois() {
    const whoisDiv = document.getElementById("whois");
    fetch("intel/whois.php?ip=" + targetIP)
        .then((response) => response.text())
        .then((data) => {
            // remove whois button
            document.getElementById("whois-button").innerHTML = "";

            // output to whois div
            whoisDiv.innerHTML = data;
        });
}

function runAll() {
    runScan('deep');
    runPing();
    runTrace();
    runWhois(targetIP);
}
