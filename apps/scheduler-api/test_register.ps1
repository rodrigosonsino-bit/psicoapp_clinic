$body = @{
    name = "TestUser"
    email = "test@test.com"
    password = "test123"
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri 'http://localhost:3000/api/auth/register' -Method Post -Body $body -ContentType 'application/json'
    Write-Host "SUCCESS: $($result | ConvertTo-Json)"
} catch {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
    Write-Host "ERROR: $($_.Exception.Message)"
    Write-Host "BODY: $responseBody"
}
