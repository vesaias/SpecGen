using Microsoft.AspNetCore.Mvc;

namespace Sample.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        return Ok();
    }

    [HttpPost]
    public IActionResult Create([FromBody] CreateProductRequest req)
    {
        return Ok();
    }
}

public record CreateProductRequest(string Name, decimal Price);
