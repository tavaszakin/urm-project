import json
from urllib import request


payload = {
    "function": {
        "kind": "add"
    },
    "initial_registers": [2, 3]
}

url = "http://127.0.0.1:8000/run-function"

req = request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)

with request.urlopen(req) as response:
    data = json.loads(response.read().decode("utf-8"))
    print(json.dumps(data, indent=2))
