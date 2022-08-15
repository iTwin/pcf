const fs = require("fs");

// useful functions
// 1. require("v8").getHeapStatistics()
// 2. JSON.parse(fs.readFileSync(path.join(process.cwd(), "blob.json")

function sizeof(obj) {
  var bytes = 0;
  function sizeOf(obj) {
    if(obj !== null && obj !== undefined) {
      switch(typeof obj) {
        case "number":
          bytes += 8;
          break;
        case "string":
          bytes += obj.length * 2;
          break;
        case "boolean":
          bytes += 4;
          break;
        case "object":
          var objClass = Object.prototype.toString.call(obj).slice(8, -1);
          if (objClass === "Object" || objClass === "Array") {
            for (var key in obj) {
              if (!obj.hasOwnProperty(key))
                continue;
              sizeOf(obj[key]);
            }
          } else {
            bytes += obj.toString().length * 2;
          }
          break;
      }
    }
    return bytes;
  }

  function formatByteSize(bytes) {
    if (bytes < 1024)
      return bytes + " bytes";
    else if (bytes < 1048576)
      return (bytes / 1024).toFixed(3) + " KiB";
    else if (bytes < 1073741824)
      return (bytes / 1048576).toFixed(3) + " MiB";
    else
      return(bytes / 1073741824).toFixed(3) + " GiB";
  }

  return formatByteSize(sizeOf(obj));
}


const file = "blob.json";
const mb = Buffer.alloc((5/3) * 100 * 1024).toString();
const n = 1000;

// 1 buffer = 6 MB JSON on disk = 2.1 MB JSON in mem
fs.writeFileSync(file, "[");
for (let i = 0; i < n; i++) {
  fs.appendFileSync("blob.json", JSON.stringify({ i: mb }));
  if (i !== n - 1)
    fs.appendFileSync(file, ",");
}
fs.appendFileSync(file, "]");

const jsonstr = fs.readFileSync(file, "utf8"); // cannot exceed ~1.9 GB
console.log(`sizeof jsonstr: ${sizeof(jsonstr)}`);
const json = JSON.parse(jsonstr);
console.log(`sizeof json: ${sizeof(json)}`);

