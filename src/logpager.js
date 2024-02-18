// hard-wired settings
const geolocate = true; // pull IP geolocation from external service?
const hostNames = true; // pull hostnames from external service?
const orgNames = true; // pull organization names from external service?
const tileLabels = false; // show tile labels on heatmap?
const apiWait = 200; // milliseconds to wait between external API calls
const maxRequestLength = 42; // truncation length of log details
const maxSearchLength = 64; // truncation length of search results

// global variables
let pollInterval;
let polling = false;
let controller;
let params = new URLSearchParams(window.location.search);
let page = params.get("page") !== null ? Number(params.get("page")) : 0;
let search = params.get("search");
let summary = params.get("summary");  // applies to search
let logType = params.get("type") !== null ? params.get("type") : "auth";  // "clf" or "auth"
let tableLength = 0;  // used to decide when to reuse the table
let geoCache = {};  // cache of geolocation data
let hostnameCache = {};  // cache of hostnames
let blacklist = {};  // cache of blacklisted IPs

// start initial data fetches
loadManifest();
loadBlacklist();

// decide what to do on page load
if (search !== null) {  // search beats page
    console.log("page load: searching for " + search + ", summary: " + summary);
    let doSummary = !(summary === "false");
    window.onload = doSearch(search, doSummary);
} else {
    console.log("page load: loading " + logType + " log...");
    // on window load run pollServer() and plotHeatmap()
    window.onload = () => {
        pollLog();
        plotHeatmap();
    };
}

// load the log manifest and update the log type tabs
function loadManifest() {
    fetch("manifest.php")
    .then((response) => response.json())
    .then((data) => {
        const haveCLF = data.includes("access.log");
        const haveAuth = data.includes("auth.log");
        if (!haveCLF) {
            document.getElementById("clftab").style.display = 'none';
            logType = "auth";  // because clf is default
        } else {
            document.getElementById("clftab").style.display = '';
        }
        if (!haveAuth) {
            document.getElementById("authtab").style.display = 'none';
        } else {
            document.getElementById("authtab").style.display = '';
        }
        // highlight the current log type
        if (logType == "clf") {
            document.getElementById("clftab").classList.add("selected");
            document.getElementById("authtab").classList.remove("selected");
        } else {
            document.getElementById("authtab").classList.add("selected");
            document.getElementById("clftab").classList.remove("selected");
        }
        console.log("logType: " + logType);
    });
}

// update time sensitive elements every second
function updateClock() {
    // find all elements with id of the form timestamp:*
    const timestampElements = document.querySelectorAll('[id^="timestamp:"]');

    // update each timestamp element
    timestampElements.forEach((element) => {
        const timestamp = element.id.replace("timestamp:", "");
        const dateObj = new Date(timestamp);
        const timediff = timeDiff(dateObj, new Date());
        element.innerHTML = timediff;
    });
}
updateClock();
setInterval(updateClock, 1000);

// enable the search button when something is typed in the search box
document.getElementById("search-input").oninput = function () {
    const searchButton = document.getElementById("search-button");
    // if the search box is empty, disable the search button
    if (this.value === "") {
        searchButton.disabled = true;
        searchButton.classList.add("disabled");
    } else {
        searchButton.disabled = false;
        searchButton.classList.remove("disabled");
    }
};

// create a Date object from a log timestamp of the form DD/Mon/YYYY:HH:MM:SS, assuming UTC timezone
function parseCLFDate(clfstamp) {
    const parts = clfstamp.split(/[:/]/); // split on : and /
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = months.indexOf(parts[1]);
    const dateObj = new Date(Date.UTC(parts[2], monthIndex, parts[0], parts[3], parts[4], parts[5]));
    return dateObj;
}

// take two Date objects and return the difference in time in simple human-readable terms, such as "3 days" or "5 seconds"
function timeDiff(date1, date2) {
    const diff = date2 - date1;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 2) {
        return days + " days";
    } else if (hours > 2) {
        return hours + " hrs";
    } else if (minutes > 5) {
        return minutes + " min";
    } else {
        return seconds + "<br>sec";
    }
}

// pull the relevent log data from the server
function pollLog() {
    console.log("pollLog: fetching page " + page + " of type " + logType);

    // abort any pending fetches
    if (controller) {
        controller.abort();
    }
    controller = new AbortController();
    if (page < 0) {
        page = 0; // reset page
    }

    // reset the URL and search
    const url = new URL(window.location.href);
    url.searchParams.delete("search");
    url.searchParams.delete("summary");
    url.searchParams.set("type", logType);
    url.searchParams.set("page", page);
    window.history.replaceState({}, "", url);
    search = null;

    // clear whois and status divs
    const whoisDiv = document.getElementById("whois");
    whoisDiv.innerHTML = "";
    const searchStatus = document.getElementById("status");
    searchStatus.innerHTML = "";

    // get the log from the server
    fetch("logtail.php?type=" + logType + "&page=" + page)
        .then((response) => response.text())
        .then((data) => {
            const pageSpan = document.getElementById("page");
            updateTable(data);
            if (page == 0) {
                pageSpan.innerHTML = "Last page";
            } else {
                pageSpan.innerHTML = "Page " + page + " from end";
            }
        });
}

// search the log for a given string
function searchLog(searchTerm, doSummary) {
    console.log("searchLog: searching for " + searchTerm);

    // abort any pending fetches
    if (controller) {
        controller.abort();
    }
    controller = new AbortController();
    if (page < 0) {
        page = 0; // reset page
    }

    // disable all other buttons and...
    const buttonDiv = document.getElementById("buttons");
    const buttons = Array.from(buttonDiv.getElementsByTagName("button"));
    buttons.forEach((button) => {
        button.disabled = true;
        button.classList.add("disabled");
    });

    // ...enable search button
    const searchButton = document.getElementById("search-button");
    searchButton.disabled = false;
    searchButton.classList.remove("disabled");

    // add a reset button to the left of the search text box if it doesn't exist
    const resetButton = document.getElementById("reset-button");
    if (resetButton === null) {
        const resetButton = document.createElement("button");
        resetButton.id = "reset-button";
        resetButton.innerHTML = "Reset";
        resetButton.classList.add("toggle-button");
        resetButton.onclick = resetSearch;
        const searchDiv = document.getElementById("search-header");
        searchDiv.insertBefore(resetButton, searchDiv.firstChild);
    } else {
        resetButton.disabled = false;
        resetButton.classList.remove("disabled");
    }

    // run the search on the server
    let summaryStr = doSummary ? "true" : "false";
    fetch("logsearch.php?type=" + logType + "&search=" + searchTerm + "&summary=" + summaryStr)
        .then((response) => response.text())
        .then((data) => {
            // write the search results to the log div
            const pageSpan = document.getElementById("page");
            pageSpan.innerHTML = "searching " + searchTerm;
            
            if (summary == null || summary === "true") {
                console.log("searchLog: summary table");
                updateSummaryTable(data);
            } else {
                console.log("searchLog: full table");
                updateTable(data);
            }
            
            // report the number of results
            const count = JSON.parse(data).length - 1;  // don't count header row
            console.log("doSearch: " + count + " results");
            const searchStatus = document.getElementById("status");
            searchStatus.innerHTML = "<b>" + count + " items found</b>";
        });
}

// plot heatmap of log entries by hour and day, potentially including a search term
function plotHeatmap(searchTerm) {
    console.log("plotHeatmap: plotting heatmap");

    // Build data query URL
    let heatmapURL = "heatmap.php?type=" + logType;
    if (searchTerm) {
        heatmapURL += "&search=" + searchTerm;
    }

    // get summary data from server
    console.log("plotHeatmap: fetching " + heatmapURL);
    fetch(heatmapURL)
        .then((response) => response.json())
        .then(jsonToHeatmap);
}

// update blacklist from server
function loadBlacklist() {
    fetch("blacklist.php")
        .then((response) => response.json())
        .then((data) => {
            blacklist = data;
            console.log("loadBlacklist: " + JSON.stringify(blacklist));
        });
}

// Take JSON array of commond log data and write HTML table
function updateTable(jsonData) {
    const data = JSON.parse(jsonData);
    const logDiv = document.getElementById("log");
    const signal = controller.signal;
    let ips = [];
    let row;

    // check to see if the table needs to be rebuilt
    if (data.length != tableLength) {
        console.log("updateTable: rebuilding table");
        tableLength = data.length;
        let table0 = '<table id="log-table" class="log">';
        for (let i = 0; i < data.length; i++) {
            table0 += '<tr id="row-' + i + '"></tr>';
        }
        table0 += "</table>";
        logDiv.innerHTML = table0;
    }

    // write table headers from first row
    let headrow = document.getElementById("row-0");
    row = "";
    for (let i = 0; i < data[0].length; i++) {
        if (i == 0) {
            row += "<th>" + data[0][i] + "</th>";
            if (hostNames) {
                row += '<th class="hideable">Domain name</th>';
            }
            if (orgNames) {
                row += '<th class="hideable">Organization</th>';
            }
            if (geolocate) {
                row +=
                    '<th>Geolocation<br>(from <a href=https://www.ip-api.com style="color: white">ip-api</a>)</th>';
            }
        } else if (i == 2) {  // details
            row += '<th class="hideable">' + data[0][i] + '</th>';
        } else {
            row += "<th>" + data[0][i] + "</th>";
        }
    }
    headrow.innerHTML = row;

    // write table rows from remaining rows
    for (let i = 1; i < data.length; i++) {
        rowElement = document.getElementById("row-" + i);
        row = "";
        for (let j = 0; j < data[i].length; j++) {
            if (j == 0) {
                // ip address
                const ip = data[i][j];
                ips.push(ip);
                // Add cell for IP address with link to search for ip address
                const srchlink = "?type=" + logType + "&search=ip:" + ip;
                row += '<td><a href=' + srchlink + '>' + ip + '</a><br>';
                row += '<nobr>';
                // Create link string that calls blacklist(ip) function
                if (blacklist.includes(ip)) {
                    row += '<button class="toggle-button tight disabled">block</button>';
                } else {
                    const blacklistCall = 'onclick="blacklistAdd(' + "'" + ip + "'" + ');"';
                    const blacklistid = 'id="block-' + ip + '"';
                    row += '<button ' + blacklistid + 'class="toggle-button tight" ' + blacklistCall + ">block</button>";
                }
                // Create link string that calls whois(ip) function
                const whoisCall = 'onclick="whois(' + "'" + ip + "'" + '); return false"';
                row += ' <button class="toggle-button tight" ' + whoisCall + ">whois</button>";
                // Create link string that opens a new tab with intel.php?ip=ip
                const traceLink = 'onclick="window.open(' + "'intel.php?ip=" + ip + "'" + '); return false"';
                row += ' <button class="toggle-button tight" ' + traceLink + ">intel</button>";
                row += "</nobr></td>";
                // Add new cell for Host name after the first cell
                if (hostNames) {
                    const hostnameid = "hostname-" + ip;
                    row += '<td class="hideable" id="' + hostnameid + '"></td>';
                }
                // Add new cell for Organization name after the first cell
                if (orgNames) {
                    const orgid = "org-" + ip;
                    row += '<td class="hideable" id="' + orgid + '"></td>';
                }
                // Add new cell for Geolocation after the first cell (maybe)
                if (geolocate) {
                    const geoid = "geo-" + ip;
                    row += '<td id="' + geoid + '"></td>';
                }
            } else if (j == 1) {
                const clfStamp = data[i][j].replace(/\s.*$/, "");  // remove the timezone
                const dateStamp = parseCLFDate(clfStamp);  // assume UTC
                const timediff = timeDiff(dateStamp, new Date());
                const jsonDate = dateStamp.toJSON();
                row += '<td id=timestamp:' + jsonDate + '>';
                row += timediff + "</td>";
            } else if (j == 2) {
                // request
                const rawRequest = data[i][j];
                // truncate request to 32 characters
                const truncRequest =
                    rawRequest.length > maxRequestLength
                        ? rawRequest.substring(0, maxRequestLength) + "..."
                        : rawRequest;
                row += '<td class="code hideable">' + truncRequest + "</td>";
            } else if (j == 3) {
                // common status handling
                const greenStatus = ["200", "304", "OK"];
                const redStatus = ["308", "400", "401", "403", "404", "500", "FAIL"];
                const status = data[i][j];
                if (greenStatus.includes(status)) {
                    row += '<td class="green">' + status + "</td>";
                } else if (redStatus.includes(status)) {
                    row += '<td class="red">' + status + "</td>";
                } else {
                    row += '<td class="gray">' + status + "</td>";
                }
            } else {
                // anything else
                row += "<td>" + data[i][j] + "</td>";
            }
        }
        rowElement.innerHTML = row;
    }

    // Get the host names from the IP addresses
    const ipSet = [...new Set(ips)]; // Get unique IP addresses
    if (hostNames) getHostNames(ipSet, signal);
    if (geolocate | orgNames) getGeoLocations(ipSet, signal);
}

// Take JSON array of commond log data and write HTML table
function updateSummaryTable(jsonData) {
    const data = JSON.parse(jsonData);
    const logDiv = document.getElementById("log");
    const signal = controller.signal;
    let ips = [];
    let row;

    // get length of the data, and limit it to maxSearchLength
    const dataLength = data.length > maxSearchLength ? maxSearchLength : data.length;

    // initialize the table
    tableLength = 0;  // reset table length
    let table0 = '<table id="log-table" class="log">';
    for (let i = 0; i < dataLength; i++) {
        table0 += '<tr id="row-' + i + '"></tr>';
    }
    table0 += "</table>";
    logDiv.innerHTML = table0;

    // write table headers from first row
    let headrow = document.getElementById("row-0");
    row = "";
    for (let i = 0; i < data[0].length; i++) {
        if (i == 1) {
            row += "<th>" + data[0][i] + "</th>";
            if (hostNames) {
                row += '<th class="hideable">Domain name</th>';
            }
            if (orgNames) {
                row += '<th class="hideable">Organization</th>';
            }
            if (geolocate) {
                row += '<th>Geolocation</th>';
            }
        } else {
            row += "<th>" + data[0][i] + "</th>";
        }
    }
    headrow.innerHTML = row;

    // write table rows from remaining rows
    for (let i = 1; i < dataLength; i++) {
        rowElement = document.getElementById("row-" + i);
        row = "";
        for (let j = 0; j < data[i].length; j++) {
            if (j == 0) {
                row += "<td><b>" + data[i][j] + "</b></td>";
            } else if (j == 1) {
                // ip address
                const ip = data[i][j];
                ips.push(ip);
                // Add cell for IP address with link to search for ip address
                const srchlink = "?type=" + logType + "&summary=false&search=ip:" + ip;
                row += '<td><a href=' + srchlink + '>' + ip + '</a><br>';
                row += '<nobr>';
                // Create link string that calls blacklistAdd(ip) function
                if (blacklist.includes(ip)) {
                    row += '<button class="toggle-button tight disabled">block</button>';
                } else {
                    const blacklistCall = 'onclick="blacklistAdd(' + "'" + ip + "'" + ');"';
                    const blacklistid = 'id="block-' + ip + '"';
                    row += '<button ' + blacklistid + 'class="toggle-button tight" ' + blacklistCall + ">block</button>";
                }
                // Create link string that calls whois(ip) function
                const whoisCall = 'onclick="whois(' + "'" + ip + "'" + '); return false"';
                row += ' <button class="toggle-button tight" ' + whoisCall + ">whois</button>";
                // Create link string that opens a new tab with intel.php?ip=ip
                const traceLink = 'onclick="window.open(' + "'intel.php?ip=" + ip + "'" + '); return false"';
                row += ' <button class="toggle-button tight" ' + traceLink + ">intel</button>";
                row += "</nobr></td>";
                // Add new cell for Host name after the first cell
                if (hostNames) {
                    const hostnameid = "hostname-" + ip;
                    row += '<td class="hideable" id="' + hostnameid + '">-</td>';
                }
                // Add new cell for Organization name after the first cell
                if (orgNames) {
                    const orgid = "org-" + ip;
                    row += '<td class="hideable" id="' + orgid + '">-</td>';
                }
                // Add new cell for Geolocation after the first cell (maybe)
                if (geolocate) {
                    const geoid = "geo-" + ip;
                    row += '<td id="' + geoid + '">-</td>';
                }
            } else if (j == 2) {  // last date
                const clfStamp = data[i][j].replace(/\s.*$/, "");  // remove the timezone
                const dateStamp = parseCLFDate(clfStamp);  // assume UTC
                const timediff = timeDiff(dateStamp, new Date());
                const jsonDate = dateStamp.toJSON();
                row += '<td id=timestamp:' + jsonDate + '>';
                row += timediff + "</td>";
            } else {
                // anything else
                row += "<td>" + data[i][j] + "</td>";
            }
        }
        rowElement.innerHTML = row;
    }

    // Get the host names from the IP addresses
    const ipSet = [...new Set(ips)]; // Get unique IP addresses
    if (hostNames) getHostNames(ipSet, signal);
    if (geolocate | orgNames) getGeoLocations(ipSet, signal);
}

// Function to send POST request to blacklist.php with a given IP address in the body of the POST
function blacklistAdd(ip) {
    console.log("blacklist: add " + ip);
    // update blacklist cache manually
    blacklist.push(ip);
    // send the IP address to the server
    var formData = new FormData();
    formData.append('ip', ip);
    fetch("blacklist.php", {
        method: "POST",
        body: formData,
    })
        .then((response) => response.text())
        .then((data) => {
            // update status div
            const status = document.getElementById("status");
            status.innerHTML = data;
            // disable all block buttons with id of the form block-ipAddress
            const blockButtons = document.querySelectorAll('[id^="block-' + ip + '"]');
            blockButtons.forEach((button) => {
                button.disabled = true;
                button.classList.add("disabled");
            });
        });
}

// Take JSON array of command log data and build SVG heatmap
function jsonToHeatmap(jsonData) {
    // Check if SVG element already exists and remove if so
    const svgElement = document.querySelector("svg");
    if (svgElement) {
        svgElement.remove();
    }

    // Process the data to work with D3 library
    let processedData = [];
    Object.keys(jsonData).forEach((date) => {
        for (let hour = 0; hour < 24; hour++) {
            const hourStr = hour.toString().padStart(2, "0");
            processedData.push({
                date: date,
                hour: hourStr,
                count:
                    jsonData[date][hourStr] !== undefined
                        ? jsonData[date][hourStr]
                        : null,
            });
        }
    });

    // Remove null values from the data
    processedData = processedData.filter((d) => d.count !== null);

    // Set dimensions for the heatmap
    const cellSize = 11; // size of each tile
    const ratio = 1; // width to height ratio
    const margin = { top: 0, right: 50, bottom: 50, left: 50 };
    const width = ratio * Object.keys(jsonData).length * cellSize;
    const height = 24 * cellSize;  // 24 hours

    // Creating scales for date axes
    const xScale = d3
        .scaleBand()
        .domain(Object.keys(jsonData))
        .range([0, width]);

    // Create array of hour label strings with leading zeros
    const hours = [];
    for (let i = 0; i < 24; i++) {
        hours.push(i.toString().padStart(2, "0"));
    }

    // Create d3 scale for hour axis as string categories from hours array
    const yScale = d3
        .scaleBand()
        .domain(hours)
        .range([0, height]);

    // Create SVG element
    const svg = d3
        .select("#heatmap")
        .append("svg")
        .attr("font-size", "12px")
        .attr("width", "100%") // Set width to 100%
        .style("height", height + "px") // Set height using CSS
        .attr(
            "viewBox",
            `${-margin.left} 0 ${width + margin.right + margin.left + 25} ${height + margin.bottom + margin.top
            }`
        ) // Add viewBox
        .append("g")
        .attr("transform", `translate(0,${margin.top})`);

    // Create color scale
    const colorScale = d3
        .scaleSqrt()
        .interpolate(() => d3.interpolatePlasma)
        .domain([1, d3.max(processedData, (d) => d.count)])
        .range([0, 1]);

    // Create the tiles and make interactive
    svg.selectAll()
        .data(processedData)
        .enter()
        .append("rect")
        .attr("x", (d) => xScale(d.date))
        .attr("y", (d) => yScale(d.hour))
        .attr("width", xScale.bandwidth() - 1) // create a gap between tiles
        .attr("height", yScale.bandwidth() - 1) // create a gap between tiles
        .style("fill", (d) => colorScale(d.count))
        .on("click", function (d) {
            // get the date and hour from the data
            const date = d.date;
            const hour = d.hour;
            // build a partial date and time string for search
            const partial = date + " " + hour + ":";
            const searchTerm = "date:" + buildTimestampSearch(date, hour);
            console.log("plotHeatmap: searching for " + searchTerm);
            // update the search box
            const searchInput = document.getElementById("search-input");
            searchInput.value = searchTerm;
            // run the search
            handleSearchForm();
        });

    // Add legend
    const legendWidth = 13;
    const legend = svg
        .selectAll(".legend")
        .data(colorScale.ticks(15))
        .enter()
        .append("g")
        .attr("class", "legend")
        .attr("width", "10%")
        .attr("transform", (d, i) => {
            return `translate(${width + 20}, ${i * legendWidth})`;
        });

    // Add rectangles to the legend elements
    legend.append("rect")
        .attr("width", legendWidth)
        .attr("height", legendWidth)
        .style("fill", colorScale);

    // Add text to the legend elements
    legend.append("text")
        .attr("x", 24)
        .attr("y", 12)
        .text((d) => d);

    // Add text labels to each tile
    if (tileLabels) {
        svg.selectAll()
            .data(processedData)
            .enter()
            .append("text")
            .attr("x", (d) => xScale(d.date) + xScale.bandwidth() / 2) // center text
            .attr("y", (d) => yScale(d.hour) + yScale.bandwidth() / 2) // center text
            .attr("dy", ".35em") // vertically align middle
            .text((d) => d.count)
            .attr("font-size", "8px")
            .attr("fill", "white")
            .attr("text-anchor", "middle")
            .style("pointer-events", "none")
            .style("opacity", "0.75");
    }
    else  // add tooltips to each tile
    {
        svg.selectAll("rect")
            .data(processedData)
            .append("title")
            .text((d) => d.count);
    }

    // Add X-axis
    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(
            d3.axisBottom(xScale).tickValues(
                xScale.domain().filter(function (d, i) {
                    return !(i % 5);
                })
            )
        ); // Adjust the tick interval as needed

    // Add Y-axis
    svg.append("g").call(d3.axisLeft(yScale));

    // Add X-axis label
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", height + 40)
        .attr("text-anchor", "middle")
        .style("font-size", "14px")
        .text("Day of the year");

    // Add Y-axis label
    svg.append("text")
        .attr("x", -(height / 2))
        .attr("y", -40)
        .attr("text-anchor", "middle")
        .attr("transform", "rotate(-90)")
        .style("font-size", "14px")
        .text("Hour of the day");

    // Add title by writing to the "heatmap-title" element
    let titleText;
    if (search) {
        titleText = "Search results by time";
    } else {
        titleText = "Log entries by time";
    }
    const titleHTMLElement = document.getElementById("heatmap-title");
    titleHTMLElement.innerHTML = titleText;

    // Center the chart in the div
    d3.select("#heatmap")
        .style("display", "flex")
        .style("justify-content", "center")
        .style("align-items", "center");
}

// take date of the form YYYY-MM-DD as one parameter, and the hour of the day as another parameter,
// and return a search string for the beginning of the corresponding common timestamp.
// example: buildSearch('2020-01-01', '12') would return '01/Jan/2020:12:'
function buildTimestampSearch(date, hour) {
    const monthnum = date.substring(5, 7);
    // convert month number to month name
    const monthnames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ];
    const month = monthnames[monthnum - 1];
    const day = date.substring(8, 10);
    const year = date.substring(0, 4);
    // add leading zero to hour if necessary
    const hourPad = hour.toString().padStart(2, "0");
    const timestamp = day + "/" + month + "/" + year + ":" + hourPad + ":";
    return timestamp;
}

// uiSearch is called when the search button is clicked by user
function handleSearchForm() {
    const searchInput = document.getElementById("search-input");
    let  searchStr = searchInput.value;
    console.log("handleSearchButton: searching for " + searchStr);

    // add search term to URL
    const url = new URL(window.location.href);
    url.searchParams.set("search", searchStr);
    url.searchParams.delete("page");
    url.searchParams.delete("summary");
    window.history.replaceState({}, "", url);

    doSearch(searchStr, true);
}

// execute search
function doSearch(searchTerm, doSummary) {
    const searchInput = document.getElementById("search-input");
    searchInput.value = searchTerm; // set search box to search term
    console.log("doSearch: searching for " + searchTerm);

    // abort any pending fetches
    if (controller) {
        controller.abort();
    }
    controller = new AbortController();

    // remove any page parameter from URL
    const url = new URL(window.location.href);
    url.searchParams.delete("page");
    window.history.replaceState({}, "", url);

    // clear whois and status divs
    const whoisDiv = document.getElementById("whois");
    whoisDiv.innerHTML = "";
    const searchStatus = document.getElementById("status");
    searchStatus.innerHTML = "";

    // run search on server
    if (search == "") {
        console.log("ERROR: search is empty!");
    } else {
        searchLog(searchTerm, doSummary);
        plotHeatmap(searchTerm);
    }
}

// reset search, re-enable all buttons and remove reset button
function resetSearch() {
    const searchInput = document.getElementById("search-input");
    const searchButton = document.getElementById("search-button");
    const resetButton = document.getElementById("reset-button");

    // enable all other buttons and...
    const buttonDiv = document.getElementById("buttons");
    const buttons = Array.from(buttonDiv.getElementsByTagName("button"));
    buttons.forEach((button) => {
        button.disabled = false;
        button.classList.remove("disabled");
    });
    
    // disable search button
    searchButton.disabled = true;
    searchButton.classList.add("disabled");

    // clear search box and remove reset button
    search = null;
    summary = null;
    searchInput.value = "";
    resetButton.remove();

    // load the log
    pollLog();
    plotHeatmap();
}

// get host names from IP addresses
function getHostNames(ips, signal) {
    console.log("Getting host names for " + ips);
    // Grab each ip address and send to rdns.php
    let rdnsWaitTime = 0;
    ips.forEach((ip) => {
        // Check cache first
        if (hostnameCache[ip]) {
            updateHostNames(hostnameCache[ip], ip);
        } else {
            setTimeout(
                () => fetchRDNS(ip),
                rdnsWaitTime,
                { signal }
            );
            rdnsWaitTime += apiWait;
        }
    });

    function updateHostNames(data, ip) {
        // Get all cells with id of the form hostname-ipAddress
        const hostnameCells = document.querySelectorAll(
            '[id^="hostname-' + ip + '"]'
        );
        let hostname;
        let whoisLink;
        // if data is in the form of an IP address, leave it alone. if it's in the form of a hostname, extract domain.tld
        if (data.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/)) {
            // data is an IP address
            hostname = null;
        } else {
            // data is a hostname, extract only the last two parts (domain.tld)
            const parts = data.split(".");
            hostname = parts[parts.length - 2] + "." + parts[parts.length - 1];
            console.log("domain: " + hostname);
        }
        if (hostname === null) {
            whoisLink = "-";
        } else {
            const whoisCall = 'onclick="whois(' + "'" + hostname + "'" + '); return false"';
            whoisLink = '<a href="#" ' + whoisCall + '>' + hostname + '</a>';
        }
        hostnameCells.forEach((cell) => {
            cell.innerHTML = whoisLink;
        });
    }

    function fetchRDNS(ip) {
        fetch("rdns.php?ip=" + ip, { signal })
            .then((response) => response.text())
            .then((data) => {
                // console.log("rdns rx: " + data);
                // cache the data
                hostnameCache[ip] = data;
                updateHostNames(data, ip);
            })
            .catch((error) => {
                if (error.name === "AbortError") {
                    console.log("rdns aborted for " + ip);
                } else {
                    console.log("Fetch error:", error);
                }
            });
    }
}

// get geolocations and orgs from IP addresses using ip-api.com
function getGeoLocations(ips, signal) {
    console.log("Getting geolocations for " + ips);
    // Grab each ip address and send to ip-api.com
    let geoWaitTime = 0;
    ips.forEach((ip) => {
        // check cache first
        if (geoCache[ip]) {
            console.log("cached geo: " + ip);
            updateGeoLocations(geoCache[ip], ip);
        } else {
            setTimeout(
                () => fetchGeoLocation(ip),
                geoWaitTime,
                { signal }
            );
            geoWaitTime += apiWait;
        }
    });

    function updateGeoLocations(data, ip) {
        // update the table cells
        if (geolocate) {
            // Get all cells with id of the form geo-ipAddress
            const geoCells = document.querySelectorAll(
                '[id^="geo-' + ip + '"]'
            );
            if (data !== null) {
                // set each cell in geoCells to data
                geoCells.forEach((cell) => {
                    cell.innerHTML =
                        data.city + ", " +
                        data.region + ", " +
                        data.countryCode;
                });
            } else {
                geoCells.forEach((cell) => {
                    cell.innerHTML = "-";
                });
            }
        }
        if (orgNames) {
            // Get all cells with id of the form org-ipAddress
            const orgCells = document.querySelectorAll(
                '[id^="org-' + ip + '"]'
            );
            if (data !== null) {
                // set each cell in orgCells to data
                orgCells.forEach((cell) => {
                    cell.innerHTML = data.org;
                });
            } else {
                orgCells.forEach((cell) => {
                    cell.innerHTML = "-";
                });
            }
        }
    }

    function fetchGeoLocation(ip) {
        fetch("geo.php?ip=" + ip, { signal })
            .then((response) => response.json())
            .then((data) => {
                // console.log("geo rx: " + ip);
                // cache the data
                geoCache[ip] = data;
                updateGeoLocations(data, ip);
            })
            .catch((error) => {
                if (error.name === "AbortError") {
                    console.log("geo fetch aborted for " + ip);
                } else {
                    console.log("Fetch error:", error);
                    updateGeoLocations(null, ip);
                }
            });
    }
}

// function to setup polling
function runWatch() {
    const uielements = [...document.querySelectorAll("button")];
    const textedit = document.getElementById("search-input");
    uielements.push(textedit);
    const watchButton = document.getElementById("watch-button");
    page = 0; // reset page
    if (polling) {
        // stop polling
        polling = false;
        clearInterval(pollInterval);
        watchButton.innerHTML = "Watch";
        watchButton.classList.remove("red");
        // enable all other ui elements
        uielements.forEach((uielement) => {
            uielement.disabled = false;
            uielement.classList.remove("disabled");
        });
        pollLog();
    } else {
        pollLog();
        polling = true;
        pollInterval = setInterval(pollLog, 10000);
        // disable all other ui elements
        uielements.forEach((uielement) => {
            uielement.disabled = true;
            uielement.classList.add("disabled");
        });
        // enable watch button
        watchButton.disabled = false;
        watchButton.classList.remove("disabled");
        watchButton.innerHTML = "Stop";
        watchButton.classList.add("red");
    }
}

// run whois query on IP address string using the ARIN.net web service. the
// response is a JSON object containing the whois information.
function whois(ip) {
    const whoisDiv = document.getElementById("whois");
    whoisDiv.innerHTML = "<h2>Whois " + ip + "...</h2>";
    fetch("whois.php?ip=" + ip)
        .then((response) => response.text())
        .then((data) => {
            // remove comment lines from whois data
            data = data.replace(/^#.*$/gm, "");

            // remove all blank lines from whois data
            data = data.replace(/^\s*[\r\n]/gm, "");

            // output to whois div
            whoisHTML = "<h2>Whois " + ip + "</h2>";
            whoisHTML += data;
            whoisDiv.innerHTML = whoisHTML;
        });
}
