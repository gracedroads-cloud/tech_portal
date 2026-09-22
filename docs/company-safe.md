# Company Safe

The Company Safe is a local, encrypted place for company software setup details,
account identifiers, license information, and private operational notes.

## Create your sole unlock code

1. Open `http://127.0.0.1:3109/company_safe.html` **on this laptop**.
2. Create an unlock code with at least 12 characters.
3. Confirm the same code.
4. Store the code offline in a secure physical location that only you control.

The code is not saved in plain text and there is no recovery method. If it is lost,
the safe cannot be decrypted.

## Use the safe

1. Open the Company Safe on the console laptop.
2. Enter the unlock code.
3. Add protected entries for software, accounts, setup information, or private notes.
4. Select **Lock safe** when finished.

The safe is unavailable over the LAN by default. Its encrypted data file,
`data/company_safe.json`, is not committed to Git and is no longer exposed by the
web server.
