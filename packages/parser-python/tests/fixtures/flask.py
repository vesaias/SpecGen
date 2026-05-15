from flask import Flask, jsonify


app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/widgets", methods=["GET", "POST"])
def widgets():
    return jsonify([])


@app.route("/api/widgets/<int:widget_id>", methods=["GET"])
def widget_detail(widget_id):
    return jsonify({"id": widget_id})
