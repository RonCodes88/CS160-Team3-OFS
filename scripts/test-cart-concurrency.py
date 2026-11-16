"""Reproduce a checkout/cart-edit race against the separate LOCAL test DB.

Run: python3 scripts/test-cart-concurrency.py
Requires psql. Uses generated fixtures only and deletes them after the check.
"""
import json
import os
import subprocess
import time
import uuid


DATABASE = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"


def query(sql):
    return subprocess.check_output(
        ["psql", DATABASE, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", sql], text=True
    ).strip()


customer, category, product, cart = [str(uuid.uuid4()) for _ in range(4)]
app_name = "ofs-cart-race-" + customer
holder = None
mutation = None
try:
    query(f"""
        insert into public.users(id,email,password_hash,role)
            values('{customer}','{customer}@cart-race.test','test-only','CUSTOMER');
        insert into public.categories(id,name,slug) values('{category}','Race test','{category}');
        insert into public.products(id,category_id,sku,name,price_cents,unit_weight,stock_quantity)
            values('{product}','{category}','{product}','Race product',100,100,10);
        insert into public.carts(id,customer_id) values('{cart}','{customer}');
        insert into public.cart_items(cart_id,product_id,quantity) values('{cart}','{product}',1);
    """)
    holder = subprocess.Popen(
        ["psql", DATABASE, "-XAt", "-v", "ON_ERROR_STOP=1"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    holder.stdin.write(f"begin; select id from public.carts where id='{cart}' for update;\n\\echo LOCKED\n")
    holder.stdin.flush()
    while holder.stdout.readline().strip() != "LOCKED":
        if holder.poll() is not None:
            raise RuntimeError("Checkout fixture could not acquire its cart lock")
    mutation = subprocess.Popen(
        ["psql", DATABASE, "-XAt", "-v", "ON_ERROR_STOP=1", "-c",
         f"select public.customer_set_cart_item('{customer}','{product}',2)"],
        env={**os.environ, "PGAPPNAME": app_name}, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )
    deadline = time.monotonic() + 10
    while query(f"select count(*) from pg_stat_activity where application_name='{app_name}' and wait_event_type='Lock'") != "1":
        if time.monotonic() > deadline:
            raise RuntimeError("Cart mutation did not wait for checkout's cart lock")
        time.sleep(0.05)
    holder.stdin.write(f"update public.carts set status='CHECKED_OUT' where id='{cart}'; commit;\n\\q\n")
    holder.stdin.flush()
    holder.communicate(timeout=10)
    output, error = mutation.communicate(timeout=10)
    if mutation.returncode:
        raise RuntimeError(error)
    result = json.loads(output)
    assert result["cart_id"] != cart, "Mutation reused the checked-out cart"
    assert result["items"][0]["quantity"] == 2, "Fresh cart did not receive the requested quantity"
    assert query(f"select quantity from public.cart_items where cart_id='{cart}'") == "1", "Mutation changed historical cart contents"
    print("PASS: waiting cart edit uses a fresh ACTIVE cart and preserves the checked-out cart")
finally:
    for process in [holder, mutation]:
        if process is not None and process.poll() is None:
            process.kill()
            process.communicate()
    query(f"""
        delete from public.carts where customer_id='{customer}';
        delete from public.products where id='{product}';
        delete from public.categories where id='{category}';
        delete from public.users where id='{customer}';
    """)
